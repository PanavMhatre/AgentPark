// Uses Groq's free API with DeepSeek-R1 — an open-source reasoning model.
// ONE coordinator call per tick: the model sees all 4 agents and assigns each a role+action.
// Keys read from VITE_GROQ_KEY_1..5 in .env.local, rotated round-robin.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL    = 'llama-3.1-8b-instant';
const VALID    = ['move_right', 'move_left', 'move_up', 'move_down', 'jump', 'push_box', 'wait'];

const GROQ_KEYS = [
  import.meta.env.VITE_GROQ_KEY_1,
  import.meta.env.VITE_GROQ_KEY_2,
  import.meta.env.VITE_GROQ_KEY_3,
  import.meta.env.VITE_GROQ_KEY_4,
  import.meta.env.VITE_GROQ_KEY_5,
].filter(Boolean);

let _keyIndex = 0;
function rotateKey() { const k = GROQ_KEYS[_keyIndex]; _keyIndex = (_keyIndex + 1) % GROQ_KEYS.length; return k; }

// ── Session memory — persists across ticks within one run, reset on level restart ──
let _mem = {
  configCounts:    {},
  progressEvents:  [],
  prevBtnStates:   null,
  agentColHistory: {},
  scoreHistory:    [],
  deathHistory:    [], // survives soft-resets so AI learns across attempts
};

// Full reset — call when changing levels
export function resetMemory() {
  _mem = { configCounts: {}, progressEvents: [], prevBtnStates: null, agentColHistory: {}, scoreHistory: [], deathHistory: [] };
}

// Soft reset — call on death/auto-restart: clears run state but keeps death history
export function softResetMemory() {
  _mem = { configCounts: {}, progressEvents: [], prevBtnStates: null, agentColHistory: {}, scoreHistory: [], deathHistory: _mem.deathHistory };
}

// Record a death event — called from App.jsx before soft-resetting
export function recordDeath(state) {
  const groundY  = state.groundY ?? (state.gridRows - 1);
  const pits     = state.pits || [];
  const hazards  = (state.hazards || []).filter(h => h.row === groundY);
  // Find agents that were at a fatal location
  const victims = state.agents
    .filter(a => pits.includes(a.col) || hazards.some(h => h.col === a.col))
    .map(a => `${a.id}@(${a.col},${a.row})`);
  const allPos = state.agents.map(a => `${a.id}:(${a.col},${a.row})`).join(' ');
  _mem.deathHistory.push({
    attempt: _mem.deathHistory.length + 1,
    cause:   state.failMessage || 'fatal',
    victims: victims.length ? victims.join(', ') : 'unknown',
    allPos,
    dangerCols: [...pits, ...hazards.map(h => h.col)],
  });
  if (_mem.deathHistory.length > 6) _mem.deathHistory.shift();
}

// Overall progress score: higher = closer to winning
function computeProgressScore(state) {
  const btnScore  = (state.buttons || []).filter(b => b.pressed).length * 100;
  const keyScore  = state.key?.collected ? 50 : 0;
  const maxCol    = Math.max(...state.agents.map(a => a.col));
  return btnScore + keyScore + maxCol;
}

// Per-agent progress vector: net col change over last N recorded positions (+ = moving right)
function agentProgressVector(agentId) {
  const hist = _mem.agentColHistory[agentId] || [];
  if (hist.length < 2) return 0;
  return hist[hist.length - 1] - hist[0];
}

// Compact hash of (agent positions + button states) — same hash = stuck in same config
function hashConfig(state) {
  const pos  = state.agents.map(a => `${a.id}${a.col}`).join('');
  const btns = (state.buttons || []).map(b => b.pressed ? '1' : '0').join('');
  return `${pos}|${btns}`;
}

// ── Parse coordinator response (returns array of 4 agent actions) ──────────────
function parseCoordinatorResponse(raw) {
  // Try to extract JSON even if response is truncated
  let jsonStr = null;
  const fullMatch = raw.match(/\{[\s\S]*\}/);
  if (fullMatch) {
    jsonStr = fullMatch[0];
  } else {
    // Truncated — grab what we have and try to close it
    const start = raw.indexOf('{');
    if (start !== -1) jsonStr = raw.slice(start);
  }
  if (!jsonStr) throw new Error('No JSON found in response');

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Try to rescue truncated JSON by extracting individual action objects
    const actionMatches = [...jsonStr.matchAll(/\{"agentId"\s*:\s*"([A-D])"[^}]*"action"\s*:\s*"([^"]+)"[^}]*\}/g)];
    if (!actionMatches.length) throw new Error('Could not parse response JSON');
    parsed = { plan: '', actions: actionMatches.map(m => ({ agentId: m[1], action: m[2], amount: 1, thought: '' })) };
  }

  const plan = parsed.plan || '';
  return (parsed.actions || []).map(a => {
    const action = VALID.includes(a.action) ? a.action : 'wait';
    const amount = (action === 'move_right' || action === 'move_left')
      ? Math.max(1, Math.round(a.amount ?? 1)) : 1;
    return {
      agentId:   String(a.agentId),
      action,
      amount,
      thought:   a.thought || '',
      message:   a.message || '',
      reasoning: `${plan ? `📋 ${plan}` : ''}${a.thought ? `\n${a.thought}` : ''}`,
    };
  });
}

// ── Coordinator prompt: full state + all 4 agents → 4 coordinated actions ──────
function buildCoordinatorPrompt(state, levelRules) {
  const goalCol  = state.goalCol ?? 10;
  const groundY  = state.groundY ?? (state.gridRows - 1);
  const pits     = state.pits || [];
  const hazards  = state.hazards || [];

  // ── Assign each unpressed button to the closest agent ──────────────────────
  const assigned = {};
  const usedAgents = new Set();
  for (const btn of [...(state.buttons || [])].filter(b => !b.pressed).sort((a,b) => a.col - b.col)) {
    const jumpCol = btn.col - 2;
    const best = [...state.agents]
      .filter(a => !usedAgents.has(a.id) && a.col <= btn.col + 1)
      .sort((x, y) => Math.abs(x.col - jumpCol) - Math.abs(y.col - jumpCol))[0];
    if (best) { assigned[best.id] = btn; usedAgents.add(best.id); }
  }

  // ── Compute SUGGESTED action per agent ─────────────────────────────────────
  function suggest(agent) {
    const btn = assigned[agent.id];
    if (btn) {
      const jumpCol = btn.col - 2;
      if (agent.col === btn.col) return `move_up — ON pad (${btn.col},${groundY}), activate ${btn.id}`;
      if (agent.col === jumpCol) {
        const midBlocked = state.agents.some(x => x.id !== agent.id && x.col === agent.col + 1)
          || (state.buttons||[]).some(b => b.latch && !b.pressed && b.id !== btn.id && b.col === agent.col + 1);
        if (midBlocked) {
          const blocker = state.agents.find(x => x.id !== agent.id && x.col === agent.col + 1);
          return `wait — (${agent.col+1},${groundY}) blocked by ${blocker ? blocker.id : 'pad'}, that agent must move_left`;
        }
        return `jump — at (${agent.col},${groundY}), landing on pad (${btn.col},${groundY}) to activate ${btn.id}`;
      }
      if (agent.col < jumpCol) return `move_right ${jumpCol - agent.col} — from (${agent.col},${agent.row}) to jump spot (${jumpCol},${groundY}) for ${btn.id}`;
      return `move_left — overshot, back from (${agent.col},${agent.row}) to jump spot (${jumpCol},${groundY})`;
    }
    // ADVANCE mode — push forward
    const stopAt = state.buttonGate && !state.buttonGate.open ? state.buttonGate.col - 1 : goalCol;
    if (agent.col >= stopAt) return `wait — at (${agent.col},${agent.row}), already at/past gate or exit col ${stopAt}`;
    if ((agent.stuckTicks||0) > 0 && agent.lastAction === 'move_up')
      return `move_right 1 — move_up stuck (no platform), advance from (${agent.col},${agent.row})`;
    const nearBtn = (state.buttons||[]).find(b => !b.pressed && b.col === agent.col + 2);
    if (nearBtn) {
      const midBlocked = state.agents.some(x => x.id !== agent.id && x.col === agent.col + 1);
      if (!midBlocked) return `jump — (${agent.col},${groundY}) to (${nearBtn.col},${groundY}), activate ${nearBtn.id}`;
    }
    const steps = Math.min(stopAt - agent.col, 6);
    return `move_right ${steps} — forward from (${agent.col},${agent.row}) toward exit (${goalCol},${groundY})`;
  }

  // ── World state: exact coords for every entity ─────────────────────────────
  const agentCoords = state.agents.map(a => {
    const role = assigned[a.id] ? `→${assigned[a.id].id}` : 'ADV';
    const stuck = (a.stuckTicks||0) > 0 ? ` STUCK${a.stuckTicks}x${a.lastAction}` : '';
    const last  = a.lastAction ? ` last:${a.lastAction}` : '';
    let warn = '';
    if ((a.stuckTicks||0) >= 1) {
      const midAgent = state.agents.find(x => x.id !== a.id && x.col === a.col + 1);
      const midBtn   = (state.buttons||[]).find(b => b.latch && !b.pressed && b.col === a.col + 1);
      if (a.lastAction === 'jump' && midAgent) warn = ` ⚠️jump blocked by ${midAgent.id}@(${midAgent.col},${midAgent.row})→${midAgent.id} must move_left`;
      else if (a.lastAction === 'jump' && midBtn) warn = ` ⚠️jump blocked by pad@(${midBtn.col},${groundY})→press that pad first`;
      else warn = ` ⚠️STUCK:do NOT repeat ${a.lastAction}`;
    }
    const blocking = state.agents.find(x => x.id !== a.id && (x.stuckTicks||0) >= 1 && x.lastAction === 'jump' && x.col + 1 === a.col);
    if (blocking) warn += ` 🚧BLOCKING ${blocking.id}'s jump→move_left NOW`;
    const sameCol = state.agents.find(x => x.id !== a.id && x.col === a.col && x.id < a.id);
    if (sameCol) warn += ` 📍CROWDED with ${sameCol.id}@same col→one must move_left`;
    return `  ${a.id} pos:(${a.col},${a.row}) role:[${role}]${last}${stuck}${warn}\n     → SUGGESTED: ${suggest(a)}`;
  }).join('\n');

  const btnCoords = (state.buttons||[]).map(b =>
    b.pressed
      ? `  ${b.id} (${b.col},${groundY}) ✓PRESSED`
      : `  ${b.id} (${b.col},${groundY}) UNPRESSED — jump-from:(${b.col-2},${groundY}), mid-path:(${b.col-1},${groundY})`
  ).join('\n') || '  none';

  const obstacleLines = [
    state.buttonGate ? `  ButtonGate (${state.buttonGate.col},${groundY}): ${state.buttonGate.open ? 'OPEN — walk through' : 'CLOSED — need all pads pressed'}` : '',
    state.gate        ? `  ZapGate (${state.gate.col},${groundY}): ${state.gate.open?'OPEN':'CLOSED'} phase=${state.tick%state.gate.period}/${state.gate.period} opens_at_phase=${state.gate.period - state.gate.openFor}` : '',
    state.key         ? `  Key (${state.key.col},${state.key.row}): ${state.key.collected ? 'COLLECTED' : 'available — walk onto it'}` : '',
    state.door        ? `  Door (${state.door.col},${groundY}): ${state.door.open ? 'OPEN' : 'LOCKED — need key'}` : '',
    pits.length       ? `  Pits at cols:[${pits.join(',')}] row:${groundY} — FATAL, jump from col pitCol-1` : '',
    hazards.filter(h=>h.row===groundY).length ? `  Hazards at cols:[${hazards.filter(h=>h.row===groundY).map(h=>h.col).join(',')}] row:${groundY} — jump over` : '',
    `  Exit col:${goalCol} row:${groundY}`,
  ].filter(Boolean).join('\n');

  // ── Progress vectors ────────────────────────────────────────────────────────
  const progressLines = state.agents.map(a => {
    const vec = agentProgressVector(a.id);
    const hist = _mem.agentColHistory[a.id] || [];
    const arrow = vec > 0 ? `→+${vec} GROWING (keep going right)` : vec < 0 ? `←${vec} shrinking (was repositioning — now go right)` : `= 0 FLAT (stuck, must change approach)`;
    return `  ${a.id}: col history [${hist.join(',')}] net:${arrow}`;
  });
  // Overall score trend
  const scores = _mem.scoreHistory;
  let scoreTrend = '';
  if (scores.length >= 2) {
    const delta = scores[scores.length - 1].score - scores[0].score;
    scoreTrend = delta > 0 ? `Overall progress score +${delta} (growing ✓ — keep doing what's working)`
      : delta === 0 ? `Overall progress score FLAT (no improvement — all agents must push right)`
      : `Overall progress score ${delta} (regressing — something went wrong, push right)`;
  }

  // ── Death history ───────────────────────────────────────────────────────────
  const deathSection = _mem.deathHistory.length
    ? '\nDEATH HISTORY — learn from past attempts, avoid repeating these mistakes:\n'
      + _mem.deathHistory.map(d =>
          `  Attempt ${d.attempt}: ${d.cause} | died: ${d.victims} | all positions: ${d.allPos}`
          + (d.dangerCols.length ? ` | DANGER cols:[${d.dangerCols.join(',')}] — MUST JUMP over these` : '')
        ).join('\n')
    : '';

  // ── Learning context ────────────────────────────────────────────────────────
  const learnedLines = _mem.progressEvents.slice(-5).map(e => {
    if (e.event === 'btn_pressed')   return `  ✓ ${e.btnId} pressed at t${e.tick} by ${e.agentId||'?'} → ${e.agentId||'that agent'} is FREE, must ADVANCE RIGHT toward exit`;
    if (e.event === 'key_collected') return `  ✓ key collected at t${e.tick} by ${e.agentId||'?'} → ALL agents ADVANCE RIGHT`;
    return null;
  }).filter(Boolean);

  return `AGENT PARK COORDINATOR — Tick ${state.tick}
OBJECTIVE: Move ALL 4 agents (A,B,C,D) to Exit col ${goalCol}. This is a RIGHT-MOVING game. Forward = move_right. That is ALWAYS the default.

LEVEL RULES: ${levelRules.replace(/\n/g,' ').slice(0,280)}

PROGRESS BAR (use this to decide direction — growing = right is working):
${progressLines.join('\n')}${scoreTrend ? '\n  ' + scoreTrend : ''}

AGENTS (current positions + what to do):
${agentCoords}

BUTTONS:
${btnCoords}

OBSTACLES & WORLD:
${obstacleLines}
${deathSection}${learnedLines.length ? '\nLEARNED THIS RUN:\n' + learnedLines.join('\n') : ''}
MOVEMENT POLICY (strictly follow):
  DEFAULT → move_right. Always push forward unless a specific exception below applies.
  move_left → ONLY to: (1) reposition for a button jump, (2) clear mid-path for a teammate jump, (3) escape a confirmed block
  wait → ONLY when: (1) at a closed gate waiting for it to open, (2) at exit already, (3) must let teammate press pad first
  jump → when a pit/hazard is 1 col ahead OR when at jump spot (btnCol-2) for a button
  move_up → ONLY when standing ON a button pad col

HARD RULES:
  • NEVER repeat an action marked ⚠️STUCK — it changed nothing, pick something else
  • NEVER move_left an ADVANCE agent unless it is explicitly blocking a teammate's jump
  • Once a button is pressed (see LEARNED), the agent that pressed it must advance right immediately

Respond ONLY with JSON (no markdown):
{"plan":"≤10 words describing coordinated strategy","actions":[{"agentId":"A","thought":"≤5 words","action":"...","amount":1},{"agentId":"B","thought":"≤5 words","action":"...","amount":1},{"agentId":"C","thought":"≤5 words","action":"...","amount":1},{"agentId":"D","thought":"≤5 words","action":"...","amount":1}]}`;
}

// ── API ────────────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function callGroq(body) {
  if (!GROQ_KEYS.length) throw new Error('No Groq API keys configured — add VITE_GROQ_KEY_1 to .env.local');
  const maxAttempts = GROQ_KEYS.length * 2;
  let lastErr = 'All API keys failed';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = rotateKey();
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (res.status === 429) { if ((attempt + 1) === GROQ_KEYS.length) await sleep(2000); continue; }
    if (res.status === 401) { lastErr = 'One or more API keys are invalid — check your .env.local'; continue; }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      try { lastErr = JSON.parse(text).error?.message || `HTTP ${res.status}`; } catch { lastErr = `HTTP ${res.status}`; }
      continue;
    }
    return await res.json();
  }
  throw new Error(lastErr);
}

// ── Single coordinator call: one LLM decides all 4 agent actions together ──────
// Compute sticky button assignments: assign the closest available agent to each unpressed button.
// Returns { agentId: button } map. Call once and persist in state.btnAssignments.
function computeStickyAssignments(state) {
  const map = {};
  const used = new Set();
  for (const btn of [...(state.buttons || [])].filter(b => !b.pressed).sort((a, b) => a.col - b.col)) {
    const jumpCol = btn.col - 2;
    const best = [...state.agents]
      .filter(a => !used.has(a.id) && a.col <= btn.col + 1)
      .sort((x, y) => Math.abs(x.col - jumpCol) - Math.abs(y.col - jumpCol))[0];
    if (best) { map[best.id] = btn.id; used.add(best.id); }
  }
  return map;
}

// Deterministic action for an agent locked to a button.
function lockedAction(agent, btn, state) {
  const jumpCol = btn.col - 2;

  // On pad col: activate with move_up
  if (agent.col === btn.col) return { action: 'move_up', thought: `activating ${btn.id}` };

  // At jump position
  if (agent.col === jumpCol) {
    const midCol    = agent.col + 1;
    const midAgent  = state.agents.find(x => x.id !== agent.id && x.col === midCol);
    const midPad    = (state.buttons || []).find(b => b.latch && !b.pressed && b.id !== btn.id && b.col === midCol);

    if (!midAgent && !midPad) {
      // Clear — jump now
      return { action: 'jump', thought: `jump → ${btn.id}` };
    }
    if (midAgent) {
      // Another agent is sitting in our mid-path — wait; they will be told to move.
      // If we've been waiting too long, step back one col to give them room to act.
      if ((agent.stuckTicks || 0) >= 3) {
        return { action: 'move_left', thought: `clearing space — ${midAgent.id} stuck at col ${midCol}` };
      }
      return { action: 'wait', thought: `waiting for ${midAgent.id} to clear col ${midCol}` };
    }
    if (midPad) {
      // An unpressed pad is in mid-path. We need someone to press it first.
      // If another locked agent is queued at our col-1 waiting to jump over us → we must step back
      const agentBehind = state.agents.find(x => x.id !== agent.id && x.col === agent.col - 1
        && state.btnAssignments && state.btnAssignments[x.id]);
      if (agentBehind) return { action: 'move_left', thought: `stepping back so ${agentBehind.id} can jump` };
      return { action: 'wait', thought: `waiting for ${midPad.id} to be pressed first` };
    }
  }

  // We're blocking another locked agent who is at our col-1 and ready to jump
  const agentBehind = state.agents.find(x =>
    x.id !== agent.id && x.col === agent.col - 1 &&
    state.btnAssignments && state.btnAssignments[x.id] &&
    x.col === ((state.buttons||[]).find(b => b.id === state.btnAssignments[x.id])?.col ?? 99) - 2
  );
  if (agentBehind) return { action: 'move_left', thought: `clearing mid-path for ${agentBehind.id}` };

  // Overshot — step back to jump position
  if (agent.col > jumpCol && agent.col < btn.col) return { action: 'move_left', thought: `back to col ${jumpCol}` };

  // Approach jump position
  const amount = Math.min(jumpCol - agent.col, 6);
  return { action: 'move_right', amount: Math.max(1, amount), thought: `→ col ${jumpCol} for ${btn.id}` };
}

export async function getAllAgentDecisions(state, levelRules) {
  if (!GROQ_KEYS.length) throw new Error('No Groq API keys — add VITE_GROQ_KEY_1 to .env.local');

  // ── Session memory: detect newly pressed buttons / collected key ──────────
  const curBtnStates = (state.buttons || []).map(b => ({ id: b.id, pressed: b.pressed }));
  if (_mem.prevBtnStates) {
    for (const cur of curBtnStates) {
      const prev = _mem.prevBtnStates.btns.find(b => b.id === cur.id);
      if (prev && !prev.pressed && cur.pressed) {
        const btn = (state.buttons || []).find(b => b.id === cur.id);
        const presser = btn ? state.agents.find(a => a.col === btn.col) : null;
        _mem.progressEvents.push({ tick: state.tick, event: 'btn_pressed', btnId: cur.id, agentId: presser?.id });
      }
    }
    if (!_mem.prevBtnStates.keyCollected && state.key?.collected) {
      const collector = state.agents.find(a => a.col === state.key?.col);
      _mem.progressEvents.push({ tick: state.tick, event: 'key_collected', agentId: collector?.id });
    }
  }
  _mem.prevBtnStates = { btns: curBtnStates, keyCollected: !!state.key?.collected };

  // ── Track agent col history + overall progress score ─────────────────────
  for (const a of state.agents) {
    if (!_mem.agentColHistory[a.id]) _mem.agentColHistory[a.id] = [];
    _mem.agentColHistory[a.id].push(a.col);
    if (_mem.agentColHistory[a.id].length > 6) _mem.agentColHistory[a.id].shift();
  }
  const score = computeProgressScore(state);
  _mem.scoreHistory.push({ tick: state.tick, score });
  if (_mem.scoreHistory.length > 8) _mem.scoreHistory.shift();

  // ── Loop detection: same exact config seen 3+ times → force escape ────────
  const configHash = hashConfig(state);
  _mem.configCounts[configHash] = (_mem.configCounts[configHash] || 0) + 1;
  const isLoop = _mem.configCounts[configHash] >= 3;
  if (isLoop) {
    // Reset count so escape gets a fresh chance next tick
    _mem.configCounts[configHash] = 0;
  }

  // Initialise or refresh sticky assignments (remove pressed buttons, assign freed agents)
  if (!state.btnAssignments) state.btnAssignments = {};
  // Clear assignments for buttons that are now pressed
  for (const [aid, bid] of Object.entries(state.btnAssignments)) {
    const btn = (state.buttons || []).find(b => b.id === bid);
    if (!btn || btn.pressed) delete state.btnAssignments[aid];
  }
  // Assign any unlatched buttons that have no agent yet
  const unassigned = (state.buttons || []).filter(b => !b.pressed && !Object.values(state.btnAssignments).includes(b.id));
  if (unassigned.length) {
    const fresh = computeStickyAssignments({ ...state, buttons: unassigned });
    Object.assign(state.btnAssignments, fresh);
  }

  // Build deterministic actions for locked agents
  const lockedActions = {};
  for (const [aid, bid] of Object.entries(state.btnAssignments)) {
    const agent = state.agents.find(a => a.id === aid);
    const btn   = (state.buttons || []).find(b => b.id === bid);
    if (agent && btn && !btn.pressed) {
      const act = lockedAction(agent, btn, state);
      lockedActions[aid] = { agentId: aid, ...act, message: '', reasoning: '' };
    }
  }

  // Proximity auto-assign: any free agent within 6 cols of a button's jump spot gets routed
  // there deterministically. Processes agents left-to-right so the closest one claims each button.
  const PROX_RANGE = 6;
  const claimedBtns = new Set(Object.values(state.btnAssignments)); // already locked buttons
  const sortedAgents = [...state.agents].sort((a, b) => a.col - b.col);
  for (const agent of sortedAgents) {
    if (lockedActions[agent.id]) continue; // already has a deterministic action
    // Find the closest unclaimed unpressed button whose jump spot is ahead of this agent
    const target = [...(state.buttons || [])]
      .filter(b => !b.pressed && !claimedBtns.has(b.id))
      .map(b => ({ btn: b, dist: (b.col - 2) - agent.col }))
      .filter(({ dist }) => dist >= 0 && dist <= PROX_RANGE)
      .sort((a, b) => a.dist - b.dist)[0]?.btn;
    if (target) {
      claimedBtns.add(target.id);
      state.btnAssignments[agent.id] = target.id; // lock this agent to the button
      const act = lockedAction(agent, target, state);
      lockedActions[agent.id] = { agentId: agent.id, ...act, message: '', reasoning: '' };
    }
  }

  // If ALL agents have locked actions, skip LLM entirely
  const freeAgents = state.agents.filter(a => !lockedActions[a.id]);
  if (freeAgents.length === 0) {
    return state.agents.map(a => lockedActions[a.id]);
  }

  // ── Hold free agents when all buttons are already covered ─────────────────
  // If every unpressed button already has a locked agent heading to it, free agents
  // have NOTHING useful to do — don't send them into button lanes via the LLM.
  const unpressedBtns = (state.buttons || []).filter(b => !b.pressed);
  const assignedBtnIds = new Set(Object.values(state.btnAssignments));
  const allBtnsCovered = unpressedBtns.length > 0
    && unpressedBtns.every(b => assignedBtnIds.has(b.id))
    && !state.buttonGate?.open;

  if (allBtnsCovered) {
    // Danger cols: jump spot (btn.col-2) and mid-path (btn.col-1) of every unpressed button
    const dangerCols = new Set(unpressedBtns.flatMap(b => [b.col - 2, b.col - 1]));
    return state.agents.map(a => {
      if (lockedActions[a.id]) return lockedActions[a.id];
      // If in a danger col, step left to clear the lane
      if (dangerCols.has(a.col)) {
        return { agentId: a.id, action: 'move_left', amount: 1, thought: 'clear lane', message: '', reasoning: '' };
      }
      // Otherwise hold — don't crowd the button area
      return { agentId: a.id, action: 'wait', thought: 'holding — btns covered', message: '', reasoning: '' };
    });
  }

  // ── Loop escape: break repeated config — bias heavily toward move_right ──────
  if (isLoop) {
    const escapeActions = freeAgents.map(agent => {
      // If this agent's progress vector is positive, they're already moving right — keep it
      if (agentProgressVector(agent.id) > 0) {
        return { agentId: agent.id, action: 'move_right', amount: 1, thought: 'progress growing →', message: '', reasoning: '' };
      }
      // Only step left if this agent is actively blocking a teammate's jump
      const isBlocker = state.agents.some(x =>
        x.id !== agent.id && (x.stuckTicks||0) > 0 && x.lastAction === 'jump' && x.col + 1 === agent.col
      );
      // Or if move_right has been stuck multiple ticks AND not because of a gate (try jump instead)
      const rightStuck = agent.lastAction === 'move_right' && (agent.stuckTicks||0) >= 2;
      let action = 'move_right';
      let thought = 'push forward';
      if (isBlocker) { action = 'move_left'; thought = 'unblock teammate'; }
      else if (rightStuck) { action = 'jump'; thought = 'try jumping obstacle'; }
      return { agentId: agent.id, action, amount: 1, thought, message: '', reasoning: '' };
    });
    const escapeMap = Object.fromEntries(escapeActions.map(a => [a.agentId, a]));
    return state.agents.map(a => lockedActions[a.id] || escapeMap[a.id]
      || { agentId: a.id, action: 'move_right', amount: 1, thought: 'advance', message: '', reasoning: '' });
  }

  // Ask LLM only about free agents (or all if none are locked)
  const data = await callGroq({
    model: MODEL,
    messages: [
      { role: 'system', content: 'You are a game coordinator. Respond with valid JSON only. No markdown fences.' },
      { role: 'user',   content: buildCoordinatorPrompt(state, levelRules) },
    ],
    temperature: 0.3,
    max_tokens:  500,
  });
  const aiActions = parseCoordinatorResponse(data.choices[0].message.content);

  // Merge: locked agents override AI, free agents use AI
  const final = state.agents.map(a => {
    if (lockedActions[a.id]) return lockedActions[a.id];
    return aiActions.find(x => x.agentId === a.id)
      || { agentId: a.id, action: 'move_right', amount: 1, thought: 'advance', message: '', reasoning: '' };
  });

  // Forward-bias override: ADVANCE agents that the LLM sends left without justification → move_right
  const goalCol = state.goalCol ?? 10;
  final.forEach(act => {
    if (lockedActions[act.agentId]) return;
    if (act.action !== 'move_left') return;
    const agent = state.agents.find(x => x.id === act.agentId);
    if (!agent) return;
    // Allow move_left only if: assigned to a button and repositioning, blocking a teammate,
    // or sitting on a button's mid-path (can't move right OR jump from here — must step back)
    const assignedBtn = state.btnAssignments?.[agent.id]
      ? (state.buttons||[]).find(b => b.id === state.btnAssignments[agent.id]) : null;
    const needsReposition = assignedBtn && agent.col > assignedBtn.col - 2 && agent.col < assignedBtn.col;
    const isBlocker = state.agents.some(x =>
      x.id !== agent.id && (x.stuckTicks||0) > 0 && x.lastAction === 'jump' && x.col + 1 === agent.col
    );
    const isAtMidPath = (state.buttons||[]).some(b => !b.pressed && b.col - 1 === agent.col);
    if (!needsReposition && !isBlocker && !isAtMidPath && agent.col < goalCol) {
      act.action = 'move_right';
      act.amount = 1;
      act.thought = 'forward bias';
    }
  });

  // Anti-loop: FREE agent stuck 2+ ticks on same action → break it, preferring move_right
  final.forEach(act => {
    if (lockedActions[act.agentId]) return;
    const agent = state.agents.find(x => x.id === act.agentId);
    if (!agent || (agent.stuckTicks || 0) < 2 || act.action !== agent.lastAction) return;
    // If agent's progress vector shows rightward movement, it's working — don't jiggle it
    if (agentProgressVector(agent.id) > 0 && act.action === 'move_right') return;
    const isBlocker = state.agents.some(a => a.id !== agent.id && (a.stuckTicks||0) > 0 && a.lastAction === 'jump' && a.col + 1 === agent.col);
    if (agent.lastAction === 'move_up') {
      act.action = 'move_right'; act.amount = 1; act.thought = 'no platform — go right';
      return;
    }
    if (agent.lastAction === 'move_right') {
      // Stuck at a button's mid-path col — can't jump through it either, must step back
      const atMidPath = (state.buttons||[]).some(b => !b.pressed && b.col - 1 === agent.col);
      act.action = atMidPath ? 'move_left' : 'jump';
      act.thought = atMidPath ? 'clear btn mid-path' : 'jump obstacle';
      return;
    }
    // Default: move_left only if blocking someone, else go right
    act.action = isBlocker ? 'move_left' : 'move_right';
    act.amount = 1;
    act.thought = isBlocker ? 'unblock' : 'push forward';
  });

  // Dedup: two free agents at same col doing same non-wait action → one goes right, one waits
  const seenColAction = {};
  final.forEach(act => {
    if (lockedActions[act.agentId] || act.action === 'wait') return;
    const agent = state.agents.find(x => x.id === act.agentId);
    if (!agent) return;
    const key = `${agent.col}:${act.action}`;
    if (seenColAction[key]) {
      // Second agent at same spot: make it wait one tick to stagger
      act.action = 'wait'; act.thought = 'stagger';
    } else {
      seenColAction[key] = true;
    }
  });

  return final;
}

export function getAllFallbackDecisions(state) {
  return state.agents.map(a => getFallback(a, state));
}

// ═════════════════════════════════════════════════════════════════════════════
// DETERMINISTIC FALLBACK — solves every level without LLM
// ═════════════════════════════════════════════════════════════════════════════

function getFallback(agent, state) {
  const { action, thought } = decide(agent, state);
  return { agentId: agent.id, action, thought, message: '', reasoning: '' };
}

// Returns true if col+1 has a ground-level hazard skull (must jump over).
function nextIsHazard(agent, state) {
  const gY = state.groundY ?? (state.gridRows - 1);
  return (state.hazards || []).some(h => h.col === agent.col + 1 && h.row === gY);
}

function decide(agent, state) {
  const idx        = ['A','B','C','D'].indexOf(agent.id);
  const goalCol    = state.goalCol ?? 11;
  const numButtons = (state.buttons || []).length;
  const hasKey     = !!state.key;
  const hasGate    = !!(state.gate?.period);
  const hasBGate   = !!state.buttonGate;
  const hasPits    = (state.pits || []).length > 0;

  if (agent.col >= goalCol) return { action: 'wait', thought: 'At goal ✓' };

  // Universal: stacked agents hop down before entering an open door
  if (state.door?.open && (agent.stackBias ?? 0) !== 0 && agent.col >= state.door.col - 1) {
    return { action: 'move_down', thought: 'Hop down — door requires solo entry' };
  }

  // Level 4: two buttons + buttonGate + timing gate + pits + boost key
  if (numButtons >= 2 && hasBGate && hasGate && hasPits) {
    if (idx === 3) return lv4_D(agent, state);
    if (idx === 2) return lv4_C(agent, state);
    if (idx === 0) return lv4_A(agent, state);
    return lv4_B(agent, state);
  }

  // Level 3: one button + buttonGate + timing gate
  if (numButtons === 1 && hasBGate && hasGate) {
    if (idx === 2) return lv3_C(agent, state);
    return lv3_navigate(agent, state, agent.id);
  }

  // Level 2: key + pits, no buttonGate, no timing gate
  if (hasKey && !hasBGate && !hasGate && hasPits) {
    return lv2_all(agent, state, idx);
  }

  // Level 1: two buttons + buttonGate + key, no pit, no timing gate
  if (numButtons >= 2 && hasBGate && !hasGate) {
    if (idx === 2) return lv1_C(agent, state);
    if (idx === 3) return lv1_D(agent, state);
    return commonNav(agent, state, agent.id);
  }

  return commonNav(agent, state, agent.id);
}

// ─── LEVEL 1: C→btn1(col4), D→btn2(col5), then all commonNav (hazard at col9) ──
function lv1_C(agent, state) {
  const btn1 = (state.buttons || []).find(b => b.id === 'btn1');
  const btn2 = (state.buttons || []).find(b => b.id === 'btn2');
  if (btn1 && !btn1.pressed) return holdLatch(agent, btn1, state, 'C: assigned to btn1 — need to jump-activate it so button-gate opens');
  // btn1 pressed — if still sitting on col 4 and btn2 not yet pressed,
  // step left so D's jump (col 3 → col 5) has a clear mid-path through col 4.
  if (btn2 && !btn2.pressed && agent.col === btn1.col) {
    return { action: 'move_left', thought: `C: btn1 pressed ✓ — stepping off col ${agent.col} so D's jump mid-path to btn2 is clear` };
  }
  return commonNav(agent, state, 'C');
}
function lv1_D(agent, state) {
  const btn1 = (state.buttons || []).find(b => b.id === 'btn1');
  const btn2 = (state.buttons || []).find(b => b.id === 'btn2');
  if (btn2 && !btn2.pressed) {
    // btn1 (col 4) sits in D's jump mid-path (col 3 → col 5).
    // Must wait for C to press btn1 first — once pressed it no longer blocks the jump.
    if (btn1 && !btn1.pressed) {
      // Step back out of C's jump lane (C jumps col 2→4; mid-path is col 3 = D's position)
      if (agent.col >= 3) {
        return { action: 'move_left', thought: `D: btn1 at col ${btn1.col} is in my jump mid-path — stepping back so C can activate btn1 first, then I can reach btn2` };
      }
      return { action: 'wait', thought: `D: holding at col ${agent.col} — waiting for C to press btn1 so my path to btn2 is clear` };
    }
    // btn1 now pressed — mid-path is clear, jump to btn2
    return holdLatch(agent, btn2, state, 'D: btn1 pressed ✓ — now jumping to activate btn2 at col 5');
  }
  return commonNav(agent, state, 'D');
}

// ─── LEVEL 2: 2 pits [5,11], platform row3 cols6-10, key at (8,3), hazard col13 ──
const L2_KEY_COL = 8;
const L2_KEY_ROW = 3;

function lv2_all(agent, state, idx) {
  const key  = state.key;
  const pits = state.pits || [];

  if (pits.includes(agent.col + 1)) return { action: 'jump', thought: `${agent.id}: pit at col ${agent.col + 1} — jumping over` };
  if (key.collected) return commonNav(agent, state, agent.id);

  if (agent.col < L2_KEY_COL) return moveRight(agent, state, `${agent.id}: advancing to col ${L2_KEY_COL} — key is on platform at (${L2_KEY_COL},${L2_KEY_ROW}), need to stack here`, L2_KEY_COL);

  if (agent.col === L2_KEY_COL) {
    if (idx === 0 && agent.row === L2_KEY_ROW + 1) return { action: 'move_up', thought: `A: stacked at row ${agent.row} — jumping up to collect key at (${L2_KEY_COL},${L2_KEY_ROW})` };
    if (agent.row === L2_KEY_ROW) return moveRight(agent, state, `${agent.id}: already on platform row — moving off so others can stack and A can boost`);
    return { action: 'wait', thought: `${agent.id}: holding at col ${L2_KEY_COL} row ${agent.row} — stacking so A (top) can move_up to reach key at row ${L2_KEY_ROW}` };
  }

  if (agent.col > L2_KEY_COL && !key.collected) return { action: 'wait', thought: `${agent.id}: past key col ${L2_KEY_COL} — holding until key is collected by A` };
  return commonNav(agent, state, agent.id);
}

// ─── LEVEL 3: btn(col4), bGate(col6), hazard(8), pit(10), hazard(12), gate(15), pit(17), key(19) ──
function lv3_C(agent, state) {
  const btn = (state.buttons || []).find(b => b.id === 'btn1');
  if (btn && !btn.pressed) return holdLatch(agent, btn, state, 'C: must activate btn1 to open button-gate at col 6');
  return lv3_navigate(agent, state, 'C');
}

function lv3_navigate(agent, state, label) {
  const gate = state.gate;
  const pits = state.pits || [];

  if (agent.col >= (state.goalCol ?? 21)) return { action: 'wait', thought: `${label}: reached exit ✓` };

  // Hold back while C is pressing the button — and clear col btn-1 so C's jump has a free mid-path
  if (state.buttonGate && !state.buttonGate.open) {
    const btn = (state.buttons || []).find(b => !b.pressed);
    if (btn && agent.col === btn.col - 1) {
      return { action: 'move_left', thought: `${label}: stepping left off col ${agent.col} — C needs this as jump mid-path to reach btn1` };
    }
    return { action: 'wait', thought: `${label}: holding at col ${agent.col} — waiting for C to press btn1 and open button-gate` };
  }

  if (pits.includes(agent.col + 1)) return { action: 'jump', thought: `${label}: pit at col ${agent.col + 1} — jumping over` };
  if (nextIsHazard(agent, state)) return { action: 'jump', thought: `${label}: skull hazard at col ${agent.col + 1} — jumping over` };
  if (gate && agent.col === gate.col - 1) {
    if (gate.open) return { action: 'move_right', amount: 1, thought: `${label}: lightning gate is OPEN (phase ${state.tick % gate.period}/${gate.period}) — stepping through now` };
    return { action: 'wait', thought: `${label}: lightning gate CLOSED at col ${gate.col} — waiting at col ${agent.col} (phase ${state.tick % gate.period}/${gate.period}, opens at ${gate.period - gate.openFor})` };
  }
  if (state.door && !state.door.open && agent.col >= state.door.col - 1) {
    return { action: 'wait', thought: `${label}: door at col ${state.door.col} is locked — need key first` };
  }
  return moveRight(agent, state, `${label}: path clear — advancing toward exit`);
}

// ─── LEVEL 4: 2 btns, bGate(8), pit(9), hazard(11), gate(14), pit(15), boost key(18), pit(21), hazard(23) ──
const L4_KEY_COL = 18;
const L4_KEY_ROW = 3;

function lv4_D(agent, state) {
  const btn1 = (state.buttons || []).find(b => b.id === 'btn1');
  if (btn1 && !btn1.pressed) return holdLatch(agent, btn1, state, 'D: jumping to activate btn1 at col 5 — must latch it before C can reach btn2');
  if (state.buttonGate && !state.buttonGate.open) {
    if (agent.col === btn1.col) return { action: 'move_left', thought: `D: btn1 latched ✓ — stepping off col ${btn1.col} so C's jump from col ${btn1.col - 1} has a clear mid-path to btn2` };
    return { action: 'wait', thought: `D: both pads need to be latched before gate opens — holding at col ${agent.col} while C activates btn2` };
  }
  return lv4_navigate(agent, state, 'D');
}
function lv4_C(agent, state) {
  const btn1 = (state.buttons || []).find(b => b.id === 'btn1');
  const btn2 = (state.buttons || []).find(b => b.id === 'btn2');
  if (btn1 && !btn1.pressed) return { action: 'wait', thought: `C: holding — D must press btn1 first to clear col ${btn1.col} before I can jump through it to reach btn2` };
  if (btn2 && !btn2.pressed) return holdLatch(agent, btn2, state, 'C: btn1 is latched — now jumping from col 4 to activate btn2 at col 6 and open the gate');
  return lv4_navigate(agent, state, 'C');
}
function lv4_A(agent, state) {
  if (!state.buttonGate?.open) return { action: 'wait', thought: `A: standing clear at col ${agent.col} — D and C are handling buttons; staying back avoids blocking their jump lanes` };
  if (!state.key.collected) return lv4_boost_A(agent, state);
  return lv4_navigate(agent, state, 'A');
}
function lv4_B(agent, state) {
  if (!state.buttonGate?.open) return { action: 'wait', thought: `B: standing clear at col ${agent.col} — button-gate still locked; will rush to col 18 boost position once gate opens` };
  if (!state.key.collected) return lv4_boost_support(agent, state, 'B');
  return lv4_navigate(agent, state, 'B');
}

function lv4_boost_A(agent, state) {
  const pits = state.pits || [];
  if (pits.includes(agent.col + 1)) return { action: 'jump', thought: `A: pit at col ${agent.col + 1} — jumping` };
  if (nextIsHazard(agent, state)) return { action: 'jump', thought: `A: skull hazard at col ${agent.col + 1} — jumping over` };
  if (state.buttonGate && !state.buttonGate.open && agent.col >= state.buttonGate.col - 1) return { action: 'wait', thought: `A: button-gate still sealed — holding` };
  const gate = state.gate;
  if (gate && agent.col === gate.col - 1) {
    if (gate.open) return { action: 'move_right', amount: 1, thought: `A: lightning gate OPEN (phase ${state.tick % gate.period}) — stepping through` };
    return { action: 'wait', thought: `A: lightning gate CLOSED at col ${gate.col} (phase ${state.tick % gate.period}/${gate.period}, opens at ${gate.period - gate.openFor}) — waiting` };
  }
  if (agent.col < L4_KEY_COL) return moveRight(agent, state, `A: racing to boost position at col ${L4_KEY_COL} — will stack with B and use move_up to grab the elevated key`, L4_KEY_COL);
  if (agent.col === L4_KEY_COL && agent.row === L4_KEY_ROW + 1) return { action: 'move_up', thought: `A: stacked at row ${agent.row} — jumping up to key at (${L4_KEY_COL},${L4_KEY_ROW})!` };
  if (agent.col === L4_KEY_COL) return { action: 'wait', thought: `A: at boost col — stacking with B (row=${agent.row}); need to be at row ${L4_KEY_ROW + 1} to reach key` };
  return moveRight(agent, state, `A: key collected — heading to exit`);
}

function lv4_boost_support(agent, state, label) {
  const pits = state.pits || [];
  if (pits.includes(agent.col + 1)) return { action: 'jump', thought: `${label}: pit at col ${agent.col + 1} — jumping` };
  if (nextIsHazard(agent, state)) return { action: 'jump', thought: `${label}: skull hazard at col ${agent.col + 1} — jumping` };
  if (state.buttonGate && !state.buttonGate.open && agent.col >= state.buttonGate.col - 1) return { action: 'wait', thought: `${label}: button-gate sealed — holding` };
  const gate = state.gate;
  if (gate && agent.col === gate.col - 1) {
    if (gate.open) return { action: 'move_right', amount: 1, thought: `${label}: lightning gate OPEN — stepping through` };
    return { action: 'wait', thought: `${label}: lightning gate CLOSED (phase ${state.tick % gate.period}/${gate.period}) — waiting` };
  }
  if (agent.col < L4_KEY_COL) return moveRight(agent, state, `${label}: heading to col ${L4_KEY_COL} to be A's boost base — will stack so A can move_up to key`, L4_KEY_COL);
  if (agent.col === L4_KEY_COL) return { action: 'wait', thought: `${label}: holding as boost base at col ${L4_KEY_COL} row ${agent.row} — waiting for A to land on top and jump to key` };
  return moveRight(agent, state, `${label}: advancing to exit`);
}

function lv4_navigate(agent, state, label) {
  const gate = state.gate;
  const pits = state.pits || [];

  if (agent.col >= (state.goalCol ?? 25)) return { action: 'wait', thought: `${label}: reached exit ✓` };
  if (pits.includes(agent.col + 1)) return { action: 'jump', thought: `${label}: pit at col ${agent.col + 1} — jumping over` };
  if (nextIsHazard(agent, state)) return { action: 'jump', thought: `${label}: skull hazard at col ${agent.col + 1} — jumping over` };
  if (state.buttonGate && !state.buttonGate.open && agent.col >= state.buttonGate.col - 1) {
    return { action: 'wait', thought: `${label}: button-gate at col ${state.buttonGate.col} locked — waiting` };
  }
  // After key: drop off platform before continuing
  if (agent.row === L4_KEY_ROW && agent.col <= L4_KEY_COL + 2 && state.key?.collected) {
    return { action: 'move_down', thought: `${label}: key collected — dropping off platform to ground level before continuing` };
  }
  if (gate && agent.col === gate.col - 1) {
    if (gate.open) return { action: 'move_right', amount: 1, thought: `${label}: lightning gate OPEN (phase ${state.tick % gate.period}) — moving through now` };
    return { action: 'wait', thought: `${label}: lightning gate CLOSED at col ${gate.col} (phase ${state.tick % gate.period}/${gate.period}, opens at ${gate.period - gate.openFor}) — waiting` };
  }
  if (state.door && !state.door.open && agent.col >= state.door.col - 1) {
    return { action: 'wait', thought: `${label}: door locked at col ${state.door.col} — key must be collected first` };
  }
  return moveRight(agent, state, `${label}: clear path — advancing toward exit`);
}

// ─── COMMON NAV — hazard+pit+gate+door aware traversal ───────────────────────
function commonNav(agent, state, label) {
  const pits = state.pits || [];
  const gate = state.gate;

  if (agent.col >= (state.goalCol ?? 11)) return { action: 'wait', thought: `${label}: reached exit ✓` };

  // Stay back while button-pressers do their work — crowding col btn-1 blocks jumps
  if (state.buttonGate && !state.buttonGate.open && (state.buttons || []).some(b => !b.pressed)) {
    return { action: 'wait', thought: `${label}: holding at col ${agent.col} — button-gate (col ${state.buttonGate.col}) still locked, letting dedicated pressers activate pads first` };
  }

  if (pits.includes(agent.col + 1)) return { action: 'jump', thought: `${label}: pit at col ${agent.col + 1} — jumping over` };
  if (nextIsHazard(agent, state)) return { action: 'jump', thought: `${label}: skull hazard at col ${agent.col + 1} — jumping over` };
  if (state.buttonGate && !state.buttonGate.open && agent.col >= state.buttonGate.col - 1) {
    return { action: 'wait', thought: `${label}: button-gate at col ${state.buttonGate.col} still sealed — waiting` };
  }
  if (gate && agent.col === gate.col - 1) {
    if (gate.open) return { action: 'move_right', amount: 1, thought: `${label}: lightning gate OPEN — stepping through` };
    return { action: 'wait', thought: `${label}: lightning gate CLOSED (phase ${state.tick % gate.period}/${gate.period}) — waiting at col ${agent.col}` };
  }
  if (state.door && !state.door.open && agent.col >= state.door.col - 1) {
    return { action: 'wait', thought: `${label}: door locked — need key first` };
  }
  return moveRight(agent, state, `${label}: advancing toward exit`);
}

// ── Utilities ────────────────────────────────────────────────────────────────

// Safe move-right amount: stops before pits, hazards, closed gates/doors.
function calcMoveRightAmount(agent, state, overrideTarget = null) {
  const MAX = 12;
  let amount = overrideTarget !== null ? (overrideTarget - agent.col) : MAX;
  const gY = state.groundY ?? (state.gridRows - 1);

  for (const p of (state.pits || [])) {
    const delta = (p - 1) - agent.col;
    if (delta > 0 && delta < amount) amount = delta;
  }
  for (const h of (state.hazards || [])) {
    if (h.row === gY) {
      const delta = (h.col - 1) - agent.col;
      if (delta > 0 && delta < amount) amount = delta;
    }
  }
  if (state.gate && !state.gate.open) {
    const delta = (state.gate.col - 1) - agent.col;
    if (delta > 0 && delta < amount) amount = delta;
  }
  if (state.buttonGate && !state.buttonGate.open) {
    const delta = (state.buttonGate.col - 1) - agent.col;
    if (delta > 0 && delta < amount) amount = delta;
  }
  for (const b of (state.buttons || [])) {
    if (b.latch && !b.pressed) {
      // Without a target: stop 3 cols before the button (col-3) to stay clear of the
      // jump lane (col-2) and mid-path (col-1). With an override target the caller
      // controls position, so use the original 1-col buffer.
      const stopOffset = overrideTarget === null ? 3 : 1;
      const delta = (b.col - stopOffset) - agent.col;
      if (delta > 0 && delta < amount) amount = delta;
    }
  }
  if (state.door && !state.door.open) {
    const delta = (state.door.col - 1) - agent.col;
    if (delta > 0 && delta < amount) amount = delta;
  }
  const goalCol = state.goalCol ?? 11;
  { const delta = goalCol - agent.col; if (delta > 0 && delta < amount) amount = delta; }

  return Math.max(1, Math.min(amount, MAX));
}

function moveRight(agent, state, label, targetCol = null) {
  const amount = calcMoveRightAmount(agent, state, targetCol);
  return { action: 'move_right', amount, thought: label };
}

// Buttons require a JUMP to activate. Stand 2 cols before and use 'jump' action.
// NOTE: only check col — agent may be stacked (row varies) but jump still lands on ground.
function holdLatch(agent, btn, state, label) {
  // On the button column: if not yet activated, use move_up to trigger it
  // (move_up may fail as movement but lastAction='move_up' activates the latch).
  // If already pressed (permanent latch), just continue.
  if (agent.col === btn.col) {
    if (!btn.pressed) return { action: 'move_up', thought: `${label} — activating pad with move_up!` };
    return { action: 'wait', thought: `${label} — pad latched ✓` };
  }
  const jumpFromCol = btn.col - 2;
  // At jump-off column: fire the jump
  if (agent.col === jumpFromCol) {
    return { action: 'jump', thought: `${label} — jumping onto pad at col ${btn.col}!` };
  }
  // Overshot jump position but not yet on button: step back
  if (agent.col > jumpFromCol && agent.col < btn.col) {
    return { action: 'move_left', thought: `${label} — back to jump position col ${jumpFromCol}` };
  }
  // Glide toward jump-off position
  return moveRight(agent, state, `${label} — to jump position col ${jumpFromCol}`, jumpFromCol);
}

function navTo(agent, tc, tr) {
  const dc = tc - agent.col, dr = tr - agent.row;
  if (Math.abs(dc) >= Math.abs(dr)) return { action: dc > 0 ? 'move_right' : 'move_left' };
  return { action: dr > 0 ? 'move_down' : 'move_up' };
}
