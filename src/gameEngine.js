// ─── Gravity helpers ──────────────────────────────────────────────────────────
// col=0 is left edge. row=0 is top. groundY is the row where the floor sits.
// Smaller row = higher up. Agents always stand on a surface.

// When several agents share a column with the same row before stacking resolves,
// sort so the tower base is D → C → B → A (demo + Pico Park roles).
const STACK_BASE_ORDER = { D: 0, C: 1, B: 2, A: 3 };
function stackBasePri(id) {
  return STACK_BASE_ORDER[id] ?? 9;
}

// Pico Park–style horizontal perch on heads: right (+1) first, then left (-1), then center (0).
// Starting right means the first person on a head leans right, signalling "left side is open"
// for the next person jumping from the left — creating a natural left→right staircase.
const HEAD_BIAS_PATTERN = [1, -1, 0];

/** Agents in the same column that share a row OR are vertically adjacent (|Δrow|===1) form one physical stack. */
function stackClustersInColumn(agents) {
  if (agents.length <= 1) return agents.map(a => [a]);
  const n = agents.length;
  const parent = [...Array(n).keys()];
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => {
    const ri = find(i), rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dr = Math.abs(agents[i].row - agents[j].row);
      if (dr === 0 || dr === 1) union(i, j);
    }
  }
  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r).push(agents[i]);
  }
  return [...buckets.values()];
}

function getSurfaces(col, platforms, groundY) {
  const base = [groundY];
  (platforms || []).forEach(p => {
    if (col >= p.x1 && col <= p.x2) base.push(p.y);
  });
  return base;
}

// Returns the lowest reachable row (floor) after gravity for an agent at `col` from `fromY`.
function getFloor(col, fromY, platforms, groundY) {
  const surfaces = getSurfaces(col, platforms, groundY).filter(y => y >= fromY);
  return surfaces.length > 0 ? Math.min(...surfaces) : groundY;
}

// Returns landing row for move_up: exactly 1 row up (Pico Park style — jump height = one character).
function getJumpTarget(col, currentY, platforms, otherAgents) {
  const targetRow = currentY - 1;
  if (targetRow < 0) return null;
  for (const p of (platforms || [])) {
    if (col >= p.x1 && col <= p.x2 && p.y === targetRow) return targetRow;
  }
  for (const a of (otherAgents || [])) {
    if (a.col === col && a.row - 1 === targetRow) return targetRow;
  }
  return null;
}

// ─── Collision helpers ────────────────────────────────────────────────────────

function isDoorBlocking(col, door) {
  if (!door || door.open) return false;
  return door.col === col;
}

function isAnyGateBlocking(col, gate, buttonGate) {
  if (gate       && !gate.open       && gate.col       === col) return true;
  if (buttonGate && !buttonGate.open && buttonGate.col === col) return true;
  return false;
}

/** Smallest row index in column (visually highest cat) among other agents — land on head at row top-1. */
function topOccupiedRowOthers(agents, col, excludeId) {
  const here = agents.filter(a => a.id !== excludeId && a.col === col);
  if (!here.length) return null;
  return Math.min(...here.map(a => a.row));
}

// ─── Box push ────────────────────────────────────────────────────────────────

function tryPushBox(agentCol, agentRow, state) {
  const { box, door, gate, buttonGate, gridCols, platforms, groundY } = state;
  if (!box) return;
  if (agentCol !== box.col - 1 || agentRow !== box.row) return;

  const nc = box.col + 1;
  if (nc >= gridCols) return;
  if (isDoorBlocking(nc, door)) return;
  if (isAnyGateBlocking(nc, gate, buttonGate)) return;

  const gY = groundY ?? state.gridRows - 1;
  box.col = nc;
  box.row = getFloor(nc, box.row, platforms || [], gY);
}

// ─── Main action applicator ──────────────────────────────────────────────────

export function applyActions(state, actions, level) {
  const s         = JSON.parse(JSON.stringify(state));
  const platforms = level.platforms || [];
  const pits      = level.pits      || [];
  const gY        = level.groundY   ?? s.gridRows - 1;

  // ── 1. Apply each agent's action ──────────────────────────────────────────
  actions.forEach(({ agentId, action, amount = 1 }) => {
    if (s.levelFailed) return;   // stop processing after first death
    const agent = s.agents.find(a => a.id === agentId);
    if (!agent) return;
    agent.prevCol = agent.col;
    agent.prevRow = agent.row;
    agent.lastAction = action;
    agent.lastAmount = (action === 'move_right' || action === 'move_left') ? Math.max(1, Math.round(amount)) : 1;
    agent.stuckTicks = 0; // reset here; incremented after action if position unchanged

    switch (action) {
      case 'move_right': {
        const steps = agent.lastAmount;
        for (let i = 0; i < steps; i++) {
          if (s.levelFailed) break;
          const nc = agent.col + 1;
          if (nc >= s.gridCols) break;
          if (isDoorBlocking(nc, s.door)) break;
          if (s.gate && !s.gate.open && s.gate.col === nc) { s.levelFailed = true; s.failMessage = '⚡ Walked into the closed zap gate!'; break; }
          if (s.buttonGate && !s.buttonGate.open && s.buttonGate.col === nc) break;
          if ((s.buttons||[]).some(b => b.latch && !b.pressed && b.col === nc)) break;
          if (s.door?.open && nc === s.door.col && (agent.stackBias ?? 0) !== 0) break;
          agent.col = nc;
          agent.row = getFloor(nc, agent.row, platforms, gY);
        }
        break;
      }
      case 'move_left': {
        const steps = agent.lastAmount;
        for (let i = 0; i < steps; i++) {
          if (s.levelFailed) break;
          const nc = agent.col - 1;
          if (nc < 0) break;
          if (isDoorBlocking(nc, s.door)) break;
          if (s.gate && !s.gate.open && s.gate.col === nc) { s.levelFailed = true; s.failMessage = '⚡ Walked into the closed zap gate!'; break; }
          if (s.buttonGate && !s.buttonGate.open && s.buttonGate.col === nc) break;
          if ((s.buttons||[]).some(b => b.latch && !b.pressed && b.col === nc)) break;
          if (s.door?.open && nc === s.door.col && (agent.stackBias ?? 0) !== 0) break;
          agent.col = nc;
          agent.row = getFloor(nc, agent.row, platforms, gY);
        }
        break;
      }
      case 'move_up': {
        // Up to 2 rows (tries 2 first, then 1). Lands on platform or teammate head.
        const others = s.agents.filter(a => a.id !== agent.id);
        const target = getJumpTarget(agent.col, agent.row, platforms, others);
        if (target !== null) agent.row = target;
        break;
      }
      case 'move_down': {
        agent.row = getFloor(agent.col, agent.row + 1, platforms, gY);
        break;
      }
      case 'jump': {
        // Pico Park–style gap clear: 2 cells forward; may land on ground or on a teammate's head in dest col.
        const dest = agent.col + 2;
        if (dest >= s.gridCols) break;
        if (isDoorBlocking(agent.col + 1, s.door) || isDoorBlocking(dest, s.door)) break;
        // Jumping into closed timing gate = instant death
        if (s.gate && !s.gate.open && (s.gate.col === agent.col + 1 || s.gate.col === dest)) { s.levelFailed = true; s.failMessage = '⚡ Jumped into the closed zap gate!'; break; }
        if (s.buttonGate && !s.buttonGate.open && (s.buttonGate.col === agent.col + 1 || s.buttonGate.col === dest)) break;
        // Block jump if mid-path (col+1) has an unpressed latch button — can't fly over it.
        // Destination is allowed: landing on a button activates it.
        if ((s.buttons||[]).some(b => b.latch && !b.pressed && b.col === agent.col + 1)) break;
        if (s.door?.open && dest === s.door.col && (agent.stackBias ?? 0) !== 0) break;

        // STAIRCASE RULE 1 — "center block":
        // If any agent occupies the intermediate column (col+1), the jump path is blocked.
        // You cannot fly over a teammate — you must have a clear gap to jump through.
        const midBlocker = s.agents.find(a => a.id !== agent.id && a.col === agent.col + 1);
        if (midBlocker) break;

        agent.col = dest;
        const topOther = topOccupiedRowOthers(s.agents, dest, agent.id);
        if (topOther !== null) {
          const onHead   = topOther - 1;
          const topAgent = s.agents.find(a => a.id !== agent.id && a.col === dest && a.row === topOther);

          // NO INTERMEDIATE LAYER: the head position must be unoccupied.
          // If another agent already landed there this same tick, fall to ground.
          const headTaken = s.agents.some(a => a.id !== agent.id && a.col === dest && a.row === onHead);

          // STAIRCASE RULE A — height: can only step up 1 row at a time.
          const heightOk = onHead >= 0 && onHead >= agent.row - 1;

          // STAIRCASE RULE B — top person must lean RIGHT (bias ≥ 0) for left-approach.
          const sideOk = !topAgent || (topAgent.stackBias ?? 0) >= 0;

          if (!headTaken && heightOk && sideOk) {
            agent.row = onHead;
          } else {
            agent.row = getFloor(dest, agent.row, platforms, gY);
          }
        } else {
          agent.row = getFloor(dest, agent.row, platforms, gY);
        }
        break;
      }
      case 'push_box': {
        tryPushBox(agent.col, agent.row, s);
        break;
      }
      case 'wait':
      default:
        break;
    }

    // Re-apply floor snap for walks; skip jump — row already set (ground or on-head), post-gravity would flatten vaults
    if (action !== 'jump') {
      agent.row = getFloor(agent.col, agent.row, platforms, gY);
    }

    // Track how many consecutive ticks this agent has tried to act but not moved
    if (action !== 'wait' && agent.col === agent.prevCol && agent.row === agent.prevRow) {
      agent.stuckTicks = (agent.stuckTicks || 0) + 1;
    } else {
      agent.stuckTicks = 0;
    }
  });

  // Early return if gate death was triggered during movement
  if (s.levelFailed) {
    s.levelComplete = false;
    s.tick += 1;
    s.log = [...(s.log || []), { type: 'system', tick: s.tick, text: s.failMessage }];
    return s;
  }

  // ── 2. Pits: always team death (Pico Park rules — anyone falls, everyone restarts) ──
  if (pits.length > 0) {
    const fallen = s.agents.find(a => pits.includes(a.col));
    if (fallen) {
      fallen.lastAction = 'fell_in_pit';
      s.levelFailed = true;
      s.failMessage = `🕳 ${fallen.id} fell in the pit — everyone restarts!`;
      s.levelComplete = false;
      s.tick += 1;
      s.log = [...(s.log || []), { type: 'system', tick: s.tick, text: s.failMessage }];
      return s;
    }
  }

  // ── 3. Stacking (per column, per connected cluster) ─────────────────────────
  // Do NOT merge everyone into one tower: e.g. B on the key platform (row 1) must stay separate from
  // D/C on the ground stack (rows 5–4), or B gets snapped back to row 3 and never collects the key.
  const byCol = {};
  s.agents.forEach(a => { (byCol[a.col] = byCol[a.col] || []).push(a); });
  Object.values(byCol).forEach(grp => {
    const clusters = stackClustersInColumn(grp);
    for (const comp of clusters) {
      if (comp.length === 1) {
        const a = comp[0];
        a.row = getFloor(a.col, a.row, platforms, gY);
        a.stackBias = 0;
        continue;
      }
      // Sort purely by ID priority so the tower order never changes:
      // D is always the base, then C, B, A on top.
      comp.sort((a, b) => stackBasePri(a.id) - stackBasePri(b.id));
      const anchor = getFloor(comp[0].col, comp[0].row, platforms, gY);
      comp.forEach((a, i) => {
        a.row = anchor - i;
        a.stackBias = i === 0 ? 0 : HEAD_BIAS_PATTERN[(i - 1) % HEAD_BIAS_PATTERN.length];
      });
    }
  });

  // ── 4. Timing gate: phase-based open/close ────────────────────────────────
  if (s.gate && s.gate.period) {
    const phase = s.tick % s.gate.period;
    s.gate.open = phase >= (s.gate.period - s.gate.openFor);
  }

  // ── 4b. Timing / sealed gate crush + hazard tiles ────────────────────────
  if (!s.levelFailed) {
    if (s.gate && !s.gate.open && s.agents.some(a => a.col === s.gate.col)) {
      s.levelFailed = true;
      s.failMessage = '⚡ The timing gate closed on you!';
    }
    if (!s.levelFailed && s.buttonGate && !s.buttonGate.open && s.agents.some(a => a.col === s.buttonGate.col)) {
      s.levelFailed = true;
      s.failMessage = '⛩ Sealed gate — you are in the wrong place!';
    }
    const hazards = level.hazards || [];
    if (!s.levelFailed && hazards.length) {
      for (const a of s.agents) {
        if (hazards.some(h => h.col === a.col && h.row === a.row)) {
          s.levelFailed = true;
          s.failMessage = '☠️ Hazard tile!';
          break;
        }
      }
    }
  }

  if (s.levelFailed) {
    s.levelComplete = false;
    s.tick += 1;
    s.log = [...(s.log || []), { type: 'system', tick: s.tick, text: s.failMessage }];
    return s;
  }

  // ── 5. Button detection (latch buttons stay pressed forever) ───────────────
  (s.buttons || []).forEach(btn => {
    if (btn.latch && btn.pressed) return;   // latched — stays on forever
    const onBtn = s.agents.find(a => a.col === btn.col && a.row === btn.row);
    // Buttons must be JUMPED onto — only 'jump' or 'move_up' activates them
    const jumpedOnIt = onBtn && (onBtn.lastAction === 'jump' || onBtn.lastAction === 'move_up');
    if (jumpedOnIt) {
      btn.pressed   = true;
      btn.pressedBy = onBtn.id;
    } else if (!btn.latch) {
      btn.pressed   = false;
      btn.pressedBy = null;
    }
  });

  // ── 6. Button-gate: opens permanently when ALL latch-buttons pressed ───────
  if (s.buttonGate) {
    if ((s.buttons || []).length > 0 && (s.buttons || []).every(b => b.pressed)) {
      s.buttonGate.open = true;
    }
  }

  // ── 7. Key collection ─────────────────────────────────────────────────────
  if (s.key && !s.key.collected) {
    const collector = s.agents.find(a => a.col === s.key.col && a.row === s.key.row);
    if (collector) { s.key.collected = true; s.key.collectedBy = collector.id; }
  }

  // ── 8. Plate logic ────────────────────────────────────────────────────────
  if (s.plate && s.box) {
    if (s.box.col === s.plate.col && s.box.row === s.plate.row) s.plate.activated = true;
  }

  // ── 9. Door logic ─────────────────────────────────────────────────────────
  if (s.door) {
    if (s.key?.collected)     s.door.open = true;
    else if (s.plate?.activated) s.door.open = true;
    else if (!s.key && !s.plate && !s.gate && !s.buttonGate) {
      s.door.open = (s.buttons || []).length > 0 && (s.buttons || []).every(b => b.pressed);
    }
  }

  // ── 10. Win: all agents inside the door (col >= exitCol), key collected if level has one
  const exitCol  = level.goalCol ?? (s.door ? s.door.col + 1 : 0);
  const allExited = s.agents.every(a => a.col >= exitCol);
  s.agentsAtGoal  = s.agents.filter(a => a.col >= exitCol).map(a => a.id);

  if (s.key) {
    s.levelComplete = s.key.collected && allExited;
  } else {
    s.levelComplete = allExited;
  }

  s.tick += 1;
  return s;
}
