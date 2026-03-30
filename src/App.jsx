import React, { useState, useEffect, useRef } from 'react';
import { LEVELS } from './levels.js';
import { applyActions } from './gameEngine.js';
import { getAllAgentDecisions, getAllFallbackDecisions } from './agentAI.js';
import { maxStepDurationMs } from './motionConfig.js';
import GameScene from './components/GameScene.jsx';
import AgentPanel from './components/AgentPanel.jsx';

const MAX_TICKS = 280;

function cloneState(s) {
  return JSON.parse(JSON.stringify(s));
}

// Pico Park color palette
const PICO = {
  orange:  '#e8734a',
  yellow:  '#f5c842',
  green:   '#5cb85c',
  blue:    '#4a90d9',
  purple:  '#9b59b6',
  red:     '#e74c3c',
  bg:      '#f7f3ee',
  card:    '#ffffff',
  border:  '#e2d9cf',
  text:    '#2c2416',
  muted:   '#9b8e82',
};

export default function App() {
  const [levelIdx,        setLevelIdx]        = useState(0);
  const [gameState,       setGameState]        = useState(null);
  const [running,         setRunning]          = useState(false);
  const [completedLevels, setCompletedLevels]  = useState(new Set());
  const [showWin,         setShowWin]          = useState(false);
  const [thinkingAgents,  setThinkingAgents]   = useState(new Set());
  const [agentReasoning,  setAgentReasoning]   = useState({ A:'', B:'', C:'', D:'' });
  const [agentThoughts,   setAgentThoughts]    = useState({ A:'', B:'', C:'', D:'' });
  const [motionBlend,     setMotionBlend]      = useState(null);
  const [animFrame,       setAnimFrame]        = useState(0);

  const stateRef    = useRef(null);
  const runningRef  = useRef(false);
  const demoRef     = useRef(false);
  const levelRef    = useRef(null);
  const blendRef    = useRef(null);
  const rafMainRef  = useRef(null);

  const beginStepRef = useRef(null);
  const processAfterCommitRef = useRef(null);
  const noProgressRef = useRef(0);
  const lastProgressSnapshotRef = useRef(null);

  const level = LEVELS[levelIdx];
  levelRef.current = level;

  useEffect(() => { resetLevel(); }, [levelIdx]);

  function resetLevel() {
    const fresh      = JSON.parse(JSON.stringify(level.initialState));
    fresh.gridCols   = level.gridCols;
    fresh.gridRows   = level.gridRows;
    fresh.goalCol    = level.goalCol;
    fresh.groundY    = level.groundY;
    fresh.pits       = level.pits || [];
    if (fresh.key        === undefined) fresh.key        = null;
    if (fresh.buttonGate === undefined) fresh.buttonGate = null;
    fresh.hazards     = level.hazards || [];
    fresh.pitFatal    = !!level.pitFatal;
    fresh.levelFailed = false;
    fresh.failMessage = '';
    fresh.btnAssignments = {};
    setGameState(fresh);
    stateRef.current = fresh;
    setShowWin(false);
    setRunning(false);
    runningRef.current = false;
    demoRef.current    = false;
    setThinkingAgents(new Set());
    setAgentReasoning({ A:'', B:'', C:'', D:'' });
    blendRef.current = null;
    setMotionBlend(null);
    if (rafMainRef.current) {
      cancelAnimationFrame(rafMainRef.current);
      rafMainRef.current = null;
    }
  }

  async function runLLMStep(s, attempt = 0) {
    setThinkingAgents(new Set(['A', 'B', 'C', 'D']));
    try {
      const actions = await getAllAgentDecisions(s, levelRef.current.rules);
      if (!runningRef.current) return;
      setThinkingAgents(new Set());
      const reasoning = {};
      const thoughts  = {};
      actions.forEach(a => {
        reasoning[a.agentId] = a.reasoning || '';
        thoughts[a.agentId]  = a.thought   || '';
      });
      setAgentReasoning(reasoning);
      setAgentThoughts(thoughts);
      beginStepRef.current(s, actions);
    } catch (err) {
      console.error('AI error:', err.message);
      if (!runningRef.current) return;
      // Rate-limit or transient error — wait and retry automatically (up to 8 attempts)
      const isRateLimit = err.message.includes('rate') || err.message.includes('All API') || err.message.includes('429');
      if (isRateLimit && attempt < 8) {
        const wait = Math.min(2000 + attempt * 1000, 8000);
        setGameState(prev => ({
          ...prev,
          log: [...(prev.log || []), { type: 'system', tick: s.tick, text: `⏳ Rate limited — retrying in ${(wait/1000).toFixed(0)}s… (attempt ${attempt+1})` }],
        }));
        setTimeout(() => { if (runningRef.current) runLLMStep(s, attempt + 1); }, wait);
      } else {
        setThinkingAgents(new Set());
        setRunning(false);
        runningRef.current = false;
        blendRef.current = null;
        setMotionBlend(null);
        setGameState(prev => ({
          ...prev,
          log: [...(prev.log || []), { type: 'system', tick: s.tick, text: `❌ AI stopped: ${err.message}` }],
        }));
      }
    }
  }

  beginStepRef.current = (fromState, actions) => {
    const lvl = levelRef.current;
    const toState = applyActions(cloneState(fromState), actions, lvl);

    // Update agent thought bubbles (works for both LLM and demo mode)
    const thoughts = {};
    actions.forEach(a => { thoughts[a.agentId] = a.thought || ''; });
    setAgentThoughts(thoughts);

    // Append action log entries for this step (include waits with meaningful reasons; skip trivial goal-reached waits)
    const logEntries = actions
      .filter(a => a.action !== 'wait' || (a.thought && !a.thought.endsWith('✓') && a.thought.trim() !== ''))
      .map(a => ({
        type:    'action',
        tick:    toState.tick,
        agentId: a.agentId,
        text:    `${a.action}${a.amount > 1 ? ` ×${a.amount}` : ''}${a.thought ? ` — ${a.thought}` : ''}`,
      }));
    if (logEntries.length) {
      toState.log = [...(toState.log || []), ...logEntries];
    }

    const dur = maxStepDurationMs(actions);

    if (dur <= 0) {
      stateRef.current = toState;
      setGameState(toState);
      blendRef.current = null;
      setMotionBlend(null);
      queueMicrotask(() => processAfterCommitRef.current(toState));
      return;
    }

    const blend = {
      fromState: cloneState(fromState),
      toState,
      actions,
      startTime: performance.now(),
      duration: dur,
    };
    blendRef.current = blend;
    setMotionBlend(blend);
  };

  processAfterCommitRef.current = (next) => {
    if (!runningRef.current) return;

    if (next.levelFailed) {
      setRunning(false);
      runningRef.current = false;
      blendRef.current = null;
      setMotionBlend(null);
      stateRef.current = next;
      setGameState(next);
      setTimeout(() => resetLevel(), 1000);
      return;
    }

    if (next.levelComplete) {
      setCompletedLevels(p => new Set([...p, levelRef.current.id]));
      setShowWin(true);
      setRunning(false);
      runningRef.current = false;
      blendRef.current = null;
      setMotionBlend(null);
      return;
    }

    // No-progress auto-reset (AI mode only): if 22 ticks pass with no new buttons pressed,
    // no key collected, and no agent moving forward — restart and try again.
    if (!demoRef.current) {
      const snap = lastProgressSnapshotRef.current;
      const btnsPressedNow = (next.buttons || []).filter(b => b.pressed).length;
      const maxColNow = Math.max(...next.agents.map(a => a.col));
      const keyNow = next.key?.collected ? 1 : 0;
      const progressScore = btnsPressedNow * 100 + keyNow * 50 + maxColNow;
      if (!snap || progressScore > snap) {
        lastProgressSnapshotRef.current = progressScore;
        noProgressRef.current = 0;
      } else {
        noProgressRef.current += 1;
        if (noProgressRef.current >= 22) {
          noProgressRef.current = 0;
          lastProgressSnapshotRef.current = null;
          setGameState(prev => ({
            ...prev,
            log: [...(prev.log || []), { type: 'system', tick: next.tick, text: '🔄 No progress — auto-restarting to try a different approach…' }],
          }));
          setTimeout(() => {
            if (!runningRef.current) return;
            // Reset state but keep simulation running in AI mode
            const fresh = JSON.parse(JSON.stringify(levelRef.current.initialState));
            fresh.gridCols   = levelRef.current.gridCols;
            fresh.gridRows   = levelRef.current.gridRows;
            fresh.goalCol    = levelRef.current.goalCol;
            fresh.groundY    = levelRef.current.groundY;
            fresh.pits       = levelRef.current.pits || [];
            fresh.hazards    = levelRef.current.hazards || [];
            fresh.pitFatal   = !!levelRef.current.pitFatal;
            fresh.levelFailed = false;
            fresh.failMessage = '';
            fresh.log = [{ type: 'system', tick: 0, text: '🔄 Retrying…' }];
            blendRef.current = null;
            setMotionBlend(null);
            stateRef.current = fresh;
            setGameState(fresh);
            runLLMStep(fresh);
          }, 800);
          return;
        }
      }
    }

    if (next.tick >= MAX_TICKS) {
      setRunning(false);
      runningRef.current = false;
      blendRef.current = null;
      setMotionBlend(null);
      setGameState(s => ({
        ...s,
        log: [...(s.log || []), { type: 'system', tick: s.tick, text: '⏱ Time limit — resetting…' }],
      }));
      setTimeout(() => resetLevel(), 2000);
      return;
    }

    if (demoRef.current) {
      setTimeout(() => {
        if (!runningRef.current) return;
        beginStepRef.current(next, getAllFallbackDecisions(next));
      }, 220);
    } else {
      // 1.5s minimum gap between AI calls to stay within rate limits
      setTimeout(() => { if (runningRef.current) runLLMStep(next); }, 1500);
    }
  };

  useEffect(() => {
    if (!running) {
      if (rafMainRef.current) {
        cancelAnimationFrame(rafMainRef.current);
        rafMainRef.current = null;
      }
      return;
    }

    const loop = () => {
      if (!runningRef.current) return;
      const b = blendRef.current;
      const now = performance.now();
      if (b) {
        if (now - b.startTime >= b.duration) {
          stateRef.current = b.toState;
          setGameState(b.toState);
          blendRef.current = null;
          setMotionBlend(null);
          processAfterCommitRef.current(b.toState);
        } else {
          setAnimFrame(x => x + 1);
        }
      }
      if (runningRef.current) {
        rafMainRef.current = requestAnimationFrame(loop);
      }
    };

    rafMainRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafMainRef.current) {
        cancelAnimationFrame(rafMainRef.current);
        rafMainRef.current = null;
      }
    };
  }, [running]);

  function startSim(demo = false) {
    if (running) {
      runningRef.current = false;
      setRunning(false);
      demoRef.current = false;
      blendRef.current = null;
      setMotionBlend(null);
      setThinkingAgents(new Set());
      if (rafMainRef.current) {
        cancelAnimationFrame(rafMainRef.current);
        rafMainRef.current = null;
      }
      return;
    }

    demoRef.current = demo;
    noProgressRef.current = 0;
    lastProgressSnapshotRef.current = null;
    setRunning(true);
    runningRef.current = true;
    setShowWin(false);

    queueMicrotask(() => {
      if (!runningRef.current) return;
      const s = stateRef.current;
      if (!s) return;
      if (demo) {
        beginStepRef.current(s, getAllFallbackDecisions(s));
      } else {
        runLLMStep(s);
      }
    });
  }

  const toggleSim = () => startSim(false);

  useEffect(() => () => {
    if (rafMainRef.current) cancelAnimationFrame(rafMainRef.current);
  }, []);


  // ── UI ──────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', backgroundColor: PICO.bg, color: PICO.text, fontFamily:"'Nunito','Segoe UI',system-ui,sans-serif" }}>

      {/* ── HEADER ── */}
      <header style={{
        backgroundColor:'#fff',
        borderBottom:`3px solid ${PICO.orange}`,
        padding:'10px 24px',
        position:'sticky', top:0, zIndex:100,
      }}>
        <div style={{ maxWidth:1400, margin:'0 auto', display:'flex', alignItems:'center', gap:20 }}>

          {/* Logo */}
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              {['#ff6b6b','#4ecdc4','#ffe66d','#a8e6cf'].map((c,i) => (
                <PicoCat key={i} color={c} size={18} />
              ))}
            </div>
            <div style={{ display:'flex', alignItems:'baseline', gap:4, marginTop:2 }}>
              <span style={{ fontSize:20, fontWeight:900, color: PICO.orange, letterSpacing:2 }}>AGENT</span>
              <span style={{ fontSize:20, fontWeight:900, color: PICO.text,   letterSpacing:2 }}>PARK</span>
            </div>
            <div style={{ fontSize:10, color: PICO.muted, marginTop:-2 }}>Pico Park for Agents</div>
          </div>

          <div style={{ width:2, height:40, backgroundColor: PICO.border }} />

          {/* Level buttons */}
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, fontWeight:700, color: PICO.muted, textTransform:'uppercase', letterSpacing:1 }}>Level</span>
            {LEVELS.map((lvl, idx) => {
              const done    = completedLevels.has(lvl.id);
              const active  = idx === levelIdx;
              return (
                <button
                  key={lvl.id}
                  onClick={() => { if (!running) setLevelIdx(idx); }}
                  disabled={running}
                  title={lvl.name}
                  style={{
                    width:36, height:36, borderRadius:8,
                    border:`3px solid ${active ? PICO.orange : done ? PICO.green : PICO.border}`,
                    backgroundColor: active ? PICO.orange : done ? '#eaf7ea' : '#fff',
                    color: active ? '#fff' : done ? PICO.green : PICO.muted,
                    fontWeight:900, fontSize:14,
                    cursor: running ? 'not-allowed' : 'pointer',
                    opacity: running ? 0.5 : 1,
                    position:'relative',
                    transition:'all 0.15s',
                    boxShadow: active ? `0 3px 0 ${PICO.orange}88` : 'none',
                  }}
                >
                  {done && !active && <span style={{ position:'absolute', top:-4, right:-4, fontSize:10 }}>✓</span>}
                  {lvl.id}
                </button>
              );
            })}
          </div>

          {/* Level name */}
          <div style={{ display:'flex', flexDirection:'column' }}>
            <span style={{ fontSize:12, fontWeight:800, color: PICO.text }}>{level.name}</span>
            <span style={{ fontSize:10, color: PICO.muted, fontStyle:'italic' }}>{level.subtitle}</span>
          </div>

          <div style={{ flex:1 }} />

          {/* Tick */}
          {(gameState?.tick||0) > 0 && (
            <span style={{ fontSize:11, fontWeight:700, color: PICO.muted, fontFamily:'monospace' }}>
              t{gameState.tick}
            </span>
          )}

          {/* Thinking indicator */}
          {thinkingAgents.size > 0 && (
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              {[0,1,2].map(i=>(
                <div key={i} style={{
                  width:6, height:6, borderRadius:'50%',
                  backgroundColor: PICO.orange,
                  animation:`dotBounce 0.8s ${i*0.15}s ease-in-out infinite`,
                }}/>
              ))}
            </div>
          )}

          {/* Gate status */}
          {gameState?.gate && (
            <div style={{
              padding:'4px 10px', borderRadius:20,
              border:`2px solid ${gameState.gate.open ? PICO.green : '#f0a500'}`,
              backgroundColor: gameState.gate.open ? '#eaf7ea' : '#fff8e1',
              fontSize:11, fontWeight:800,
              color: gameState.gate.open ? PICO.green : '#f0a500',
            }}>
              GATE {gameState.gate.open ? 'OPEN' : 'CLOSED'} {gameState.tick % (gameState.gate.period||6)}/{gameState.gate.period||6}
            </div>
          )}

          {/* Reset */}
          <button
            onClick={resetLevel}
            disabled={running}
            style={{
              padding:'6px 14px', borderRadius:8,
              border:`2px solid ${PICO.border}`,
              backgroundColor:'#fff', color: PICO.muted,
              fontWeight:700, fontSize:13, cursor: running ? 'not-allowed' : 'pointer',
              opacity: running ? 0.4 : 1,
            }}
          >↺ Reset</button>

          {/* Demo (deterministic, no LLM) */}
          <button
            onClick={() => startSim(true)}
            disabled={showWin || (running && !demoRef.current)}
            title="Run with built-in logic — no AI API needed"
            style={{
              padding:'7px 16px', borderRadius:10,
              border:`3px solid ${running && demoRef.current ? PICO.red : PICO.blue}`,
              backgroundColor: running && demoRef.current ? PICO.red : PICO.blue,
              color:'#fff', fontWeight:900, fontSize:13,
              cursor: (showWin || (running && !demoRef.current)) ? 'not-allowed' : 'pointer',
              opacity: (showWin || (running && !demoRef.current)) ? 0.4 : 1,
              boxShadow: running && demoRef.current ? `0 4px 0 #2563eb` : `0 4px 0 #1d4ed8`,
              transition:'all 0.1s',
            }}
          >
            {running && demoRef.current ? '⏸ Stop' : '⚡ Demo'}</button>

          {/* Run/Pause (LLM) */}
          <button
            onClick={toggleSim}
            disabled={showWin || (running && demoRef.current)}
            title="Run with DeepSeek-R1 AI agents via Groq"
            style={{
              padding:'7px 22px', borderRadius:10,
              border:`3px solid ${running && !demoRef.current ? PICO.red : PICO.orange}`,
              backgroundColor: running && !demoRef.current ? PICO.red : PICO.orange,
              color:'#fff', fontWeight:900, fontSize:14,
              cursor: (showWin || (running && demoRef.current)) ? 'not-allowed' : 'pointer',
              opacity: (showWin || (running && demoRef.current)) ? 0.4 : 1,
              boxShadow: running && !demoRef.current ? `0 4px 0 #a93226` : `0 4px 0 #b85a35`,
              transition:'all 0.1s',
            }}
          >
            {running && !demoRef.current ? '⏸ Pause' : '▶ Run AI'}
          </button>
        </div>
      </header>

      {/* ── BODY ── */}
      <div style={{ maxWidth:1400, margin:'0 auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:16 }}>
        <div style={{ display:'flex', gap:20, alignItems:'flex-start', flexWrap:'wrap' }}>

          {/* ── LEFT: level card + grid ── */}
          <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:16 }}>

            {/* Level card */}
            <div style={{
              backgroundColor: PICO.card,
              border:`2px solid ${PICO.border}`,
              borderRadius:16,
              padding:20,
              borderTop:`4px solid ${PICO.orange}`,
            }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:14 }}>
                {/* Level badge */}
                <div style={{
                  width:44, height:44, borderRadius:12,
                  backgroundColor: PICO.orange, color:'#fff',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:22, fontWeight:900, flexShrink:0,
                }}>{level.id}</div>

                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap' }}>
                    <span style={{ fontSize:18, fontWeight:900, color: PICO.text }}>{level.name}</span>
                    <span style={{ fontSize:12, color: PICO.muted, fontStyle:'italic' }}>{level.subtitle}</span>
                  </div>
                  <p style={{ fontSize:13, color: PICO.muted, marginTop:6, lineHeight:1.5 }}>{level.description}</p>
                </div>
              </div>

              {/* Objective */}
              <div style={{
                marginTop:14, padding:'10px 14px', borderRadius:10,
                backgroundColor:'#eaf7ea',
                border:`1.5px solid #c3e6c3`,
              }}>
                <span style={{ fontSize:11, fontWeight:800, color: PICO.green, textTransform:'uppercase', letterSpacing:0.5 }}>Objective  </span>
                <span style={{ fontSize:13, color:'#2d5a2d' }}>{level.objective}</span>
              </div>

              {/* Mechanics — who does what is left to the agents / models */}
              <div style={{ marginTop:14 }}>
                <div style={{ fontSize:11, fontWeight:800, color: PICO.muted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Mechanics</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {level.mechanics.map((m,i) => (
                    <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
                      <span style={{
                        width:24, height:24, borderRadius:6,
                        backgroundColor:'#f5f0ea', border:`1.5px solid ${PICO.border}`,
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:13, flexShrink:0,
                      }}>{m.icon}</span>
                      <div>
                        <div style={{ fontSize:12, fontWeight:700, color: PICO.text }}>{m.label}</div>
                        <div style={{ fontSize:11, color: PICO.muted, lineHeight:1.4 }}>{m.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Platformer Scene — fills card width so the sky panel isn't half empty */}
            {gameState && (
              <div style={{
                backgroundColor: '#c9e8ff',
                border:`2px solid ${PICO.border}`,
                borderRadius:16,
                padding:6,
                width:'100%',
                maxWidth:'100%',
                minWidth:0,
                boxSizing:'border-box',
              }}>
                <GameScene
                  state={gameState}
                  level={level}
                  thinkingAgents={thinkingAgents}
                  motionBlend={motionBlend}
                  animFrame={animFrame}
                />
              </div>
            )}

            {/* Win banner */}
            {showWin && (
              <div className="win-pop" style={{
                backgroundColor:'#fff',
                border:`3px solid ${PICO.green}`,
                borderRadius:16, padding:28, textAlign:'center',
                boxShadow:`0 6px 0 #3d8b3d`,
              }}>
                <div style={{ fontSize:48, marginBottom:8 }}>🎉</div>
                <div style={{ fontSize:24, fontWeight:900, color: PICO.green, letterSpacing:2 }}>LEVEL COMPLETE!</div>
                <p style={{ color: PICO.muted, marginTop:6 }}>The agents cooperated perfectly.</p>
                {levelIdx < LEVELS.length - 1 ? (
                  <button
                    onClick={() => setLevelIdx(i => i + 1)}
                    style={{
                      marginTop:16, padding:'10px 28px', borderRadius:10,
                      border:`3px solid ${PICO.orange}`,
                      backgroundColor: PICO.orange, color:'#fff',
                      fontWeight:900, fontSize:15, cursor:'pointer',
                      boxShadow:`0 4px 0 #b85a35`,
                    }}
                  >Next Level →</button>
                ) : (
                  <div style={{ marginTop:16, fontSize:18, fontWeight:900, color: PICO.orange }}>
                    All 4 levels complete! 🏆
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── RIGHT: agent panel ── */}
          <div style={{ width:320, flexShrink:0 }}>
            {gameState && (
              <AgentPanel
                agents={gameState.agents}
                log={gameState.log || []}
                thinkingAgents={thinkingAgents}
                agentReasoning={agentReasoning}
                agentThoughts={agentThoughts}
                state={gameState}
                running={running}
              />
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Pico Park style cat character ─────────────────────────────────────────────
export function PicoCat({ color, size = 24, style: extraStyle }) {
  const ear = Math.round(size * 0.22);
  const eye = Math.round(size * 0.16);
  return (
    <div style={{
      width: size, height: size,
      position:'relative',
      display:'inline-flex', alignItems:'center', justifyContent:'center',
      flexShrink: 0,
      ...extraStyle,
    }}>
      {/* Ears */}
      <div style={{
        position:'absolute', top:0, left:0, right:0,
        display:'flex', justifyContent:'space-between', paddingLeft:2, paddingRight:2,
      }}>
        <div style={{ width:ear, height:ear, backgroundColor:color, borderRadius:'2px 2px 0 0' }} />
        <div style={{ width:ear, height:ear, backgroundColor:color, borderRadius:'2px 2px 0 0' }} />
      </div>
      {/* Body */}
      <div style={{
        position:'absolute', bottom:0, left:0, right:0,
        height: Math.round(size * 0.76),
        backgroundColor: color, borderRadius:4,
        display:'flex', alignItems:'center', justifyContent:'center', gap: Math.round(size*0.14),
      }}>
        {/* Eyes */}
        <div style={{ width:eye, height:eye, borderRadius:'50%', backgroundColor:'#fff' }}>
          <div style={{ width:'60%', height:'60%', borderRadius:'50%', backgroundColor:'#2c2416', margin:'20% auto' }} />
        </div>
        <div style={{ width:eye, height:eye, borderRadius:'50%', backgroundColor:'#fff' }}>
          <div style={{ width:'60%', height:'60%', borderRadius:'50%', backgroundColor:'#2c2416', margin:'20% auto' }} />
        </div>
      </div>
    </div>
  );
}
