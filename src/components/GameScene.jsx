import React, { useEffect, useRef, useMemo, useState } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────
const CW          = 60;     // cell width  (px)
const CH          = 54;     // cell height (px)
const CAT_SIZE    = 36;     // cat sprite size (px)
// Gap jump arc (pit leap) — slightly lower than before so it feels less “floaty”
const GAP_JUMP_ARC_PEAK = Math.max(CW, CH) * 0.78;
// `move_up` onto heads/platforms: generous hop arc so stacking is clearly readable
const VAULT_ARC_PER_ROW = CH * 0.72;
// `move_down` drop: slight overshoot dip below the straight path (feels like gravity)
const DROP_ARC = CH * 0.22;
// Horizontal offset per stackBias step (left / mid / right on teammate's head)
const STACK_BIAS_X = CW * 0.16;

function stackBiasPx(agent) {
  return (agent?.stackBias ?? 0) * STACK_BIAS_X;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function smoothstep01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function actionForAgent(blend, id) {
  if (!blend?.actions) return null;
  const row = blend.actions.find(a => a.agentId === id);
  return row?.action ?? null;
}

/**
 * Position uses smoothstep easing (soft accel/decel).
 * `move_up` = hop arc (1 row). Multi-row upward = sequential hops, one per row.
 * `jump`    = larger arc for gap clears.
 * Multi-row downward (stacking drop / move_down) = sequential dips, one per row.
 */
function agentRenderLayout(agent, motionBlend) {
  if (!motionBlend) {
    return {
      x: agent.col * CW + (CW - CAT_SIZE) / 2 + stackBiasPx(agent),
      y: agent.row * CH - CAT_SIZE,
      shadowCol: agent.col,
      shadowRow: agent.row,
      shadowBias: agent.stackBias ?? 0,
      airborne: false,
      displayAction: agent.lastAction,
    };
  }

  const { fromState, toState, startTime, duration } = motionBlend;
  const fromA = fromState.agents.find(a => a.id === agent.id);
  const toA   = toState.agents.find(a => a.id === agent.id);
  if (!fromA || !toA) {
    return agentRenderLayout(agent, null);
  }

  const rawT = duration > 0 ? (performance.now() - startTime) / duration : 1;
  const tLin = Math.max(0, Math.min(1, rawT));

  const action = actionForAgent(motionBlend, agent.id);
  const dCol   = Math.abs(toA.col - fromA.col);
  const dRow   = Math.abs(toA.row - fromA.row);
  const goUp   = toA.row < fromA.row;
  const goDown = toA.row > fromA.row;

  const isWalk    = (action === 'move_right' || action === 'move_left') && dCol >= 1 && dRow === 0;
  const isGapJump = action === 'jump' && dCol >= 2;

  // Any upward row change (stacking up, move_up) — sequential hops
  const isAnyUp   = goUp   && dRow >= 1 && !isGapJump;
  // Any downward row change (stacking down, move_down) — sequential dips
  const isAnyDown = goDown && dRow >= 1 && !isGapJump;

  // Walk uses linear t so multi-cell glides feel smooth
  const t  = isWalk ? tLin : smoothstep01(tLin);
  const col = lerp(fromA.col, toA.col, t);
  const sb  = lerp(fromA.stackBias ?? 0, toA.stackBias ?? 0, t);

  let row  = lerp(fromA.row, toA.row, t);
  let arcY = 0;

  if (isGapJump) {
    // Horizontal gap leap — single arc, row interpolates normally
    arcY = Math.sin(tLin * Math.PI) * GAP_JUMP_ARC_PEAK;

  } else if (isAnyUp) {
    // Sequential per-row hops — each row gets its own arc peak
    const hopCount = dRow;                          // one hop per row
    const hopFrac  = 1.0 / hopCount;
    const hopIdx   = Math.min(hopCount - 1, Math.floor(tLin / hopFrac));
    const hopT     = (tLin - hopIdx * hopFrac) / hopFrac;  // 0→1 inside this hop

    const segFrom = fromA.row - hopIdx;             // integer row at hop start
    row  = lerp(segFrom, segFrom - 1, smoothstep01(hopT));
    arcY = Math.sin(hopT * Math.PI) * VAULT_ARC_PER_ROW;

  } else if (isAnyDown) {
    // Sequential per-row drops — each row gets its own dip
    const hopCount = dRow;
    const hopFrac  = 1.0 / hopCount;
    const hopIdx   = Math.min(hopCount - 1, Math.floor(tLin / hopFrac));
    const hopT     = (tLin - hopIdx * hopFrac) / hopFrac;

    const segFrom = fromA.row + hopIdx;             // integer row at drop start
    row  = lerp(segFrom, segFrom + 1, smoothstep01(hopT));
    arcY = -Math.sin(hopT * Math.PI) * DROP_ARC;
  }

  const x = col * CW + (CW - CAT_SIZE) / 2 + sb * STACK_BIAS_X;
  const y = row * CH - CAT_SIZE - arcY;

  return {
    x,
    y,
    shadowCol: toA.col,
    shadowRow: toA.row,
    shadowBias: toA.stackBias ?? 0,
    airborne: arcY > 3,
    displayAction: action || agent.lastAction,
  };
}

/** Mid-blend: show key picked up / door open before commit so HUD doesn’t “teleport”. */
function visualWorldState(state, motionBlend) {
  if (!motionBlend?.toState) return state;
  const rawT = motionBlend.duration > 0
    ? (performance.now() - motionBlend.startTime) / motionBlend.duration
    : 1;
  const cross = rawT > 0.38;
  if (!cross) return state;
  const to = motionBlend.toState;
  return {
    ...state,
    key: state.key && to.key ? { ...state.key, ...to.key } : state.key,
    door: state.door && to.door ? { ...state.door, ...to.door } : state.door,
    box: state.box && to.box ? { ...state.box, ...to.box } : state.box,
    plate: state.plate && to.plate ? { ...state.plate, ...to.plate } : state.plate,
    buttons: to.buttons ?? state.buttons,
    // Timing gate: only update on commit so “closes on you” matches logic + death check
    buttonGate: to.buttonGate ?? state.buttonGate,
  };
}

// ─── Group consecutive pit cols into visual ranges ────────────────────────────
function pitRanges(pits) {
  if (!pits || pits.length === 0) return [];
  const sorted = [...pits].sort((a, b) => a - b);
  const ranges = [];
  let x1 = sorted[0], x2 = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === x2 + 1) { x2 = sorted[i]; }
    else { ranges.push({ x1, x2 }); x1 = x2 = sorted[i]; }
  }
  ranges.push({ x1, x2 });
  return ranges;
}

// ─── Pico Park cat ────────────────────────────────────────────────────────────
function PicoCat({ color = '#ff6b6b', size = 32, bouncing = false, goal = false }) {
  const lighter = color + 'cc';
  return (
    <div style={{
      width: size, height: size, position: 'relative',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      animation: bouncing ? 'agentBounce 0.4s ease-in-out infinite alternate'
               : goal     ? 'winPop 0.6s ease-in-out infinite alternate'
               : 'none',
      filter: goal ? 'drop-shadow(0 0 6px #4CAF50)' : 'none',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', gap: size * 0.25, marginBottom: -size * 0.08, zIndex: 1 }}>
        <div style={{ width: size * 0.22, height: size * 0.22, backgroundColor: color, clipPath: 'polygon(50% 0%,100% 100%,0% 100%)', borderRadius: '2px 2px 0 0' }} />
        <div style={{ width: size * 0.22, height: size * 0.22, backgroundColor: color, clipPath: 'polygon(50% 0%,100% 100%,0% 100%)', borderRadius: '2px 2px 0 0' }} />
      </div>
      <div style={{ width: size * 0.72, height: size * 0.6, backgroundColor: color, borderRadius: '8px 8px 6px 6px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: size * 0.12 }}>
        <div style={{ width: size * 0.12, height: size * 0.15, backgroundColor: '#1a1a2e', borderRadius: '50%', marginTop: -size * 0.05 }} />
        <div style={{ width: size * 0.12, height: size * 0.15, backgroundColor: '#1a1a2e', borderRadius: '50%', marginTop: -size * 0.05 }} />
      </div>
      <div style={{ width: size * 0.6, height: size * 0.3, backgroundColor: lighter, borderRadius: '4px 4px 6px 6px', marginTop: 1 }} />
    </div>
  );
}

// ─── Ground strip ─────────────────────────────────────────────────────────────
function GroundStrip({ sceneW, sceneH, groundPx, pits = [] }) {
  const cols = Math.ceil(sceneW / CW);
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: groundPx, width: sceneW, height: sceneH - groundPx, backgroundColor: '#7a5c2e', zIndex: 2 }} />
      {/* Grass top — drawn per-column so we can skip pit cols */}
      {Array.from({ length: cols }).map((_, c) => {
        if (pits.includes(c)) return null;
        return (
          <React.Fragment key={c}>
            <div style={{ position: 'absolute', left: c * CW, top: groundPx, width: CW, height: 10, backgroundColor: '#5a9e3c', zIndex: 3 }} />
            <div style={{ position: 'absolute', left: c * CW + CW * 0.3, top: groundPx - 6, width: 4, height: 8, backgroundColor: '#4a8e2c', borderRadius: '2px 2px 0 0', zIndex: 3 }} />
          </React.Fragment>
        );
      })}
      {/* Subtle earth seams */}
      {Array.from({ length: cols }).map((_, c) =>
        c % 2 === 0 && !pits.includes(c) ? (
          <div key={`es${c}`} style={{ position: 'absolute', left: c * CW, top: groundPx + 10, width: CW, height: sceneH - groundPx - 10, backgroundColor: 'rgba(0,0,0,0.05)', zIndex: 2 }} />
        ) : null
      )}
    </>
  );
}

// ─── Platform block ───────────────────────────────────────────────────────────
function PlatformBlock({ x1, x2, y, groundPx }) {
  const left  = x1 * CW;
  const width = (x2 - x1 + 1) * CW;
  const top   = y * CH;
  // Sky-high platforms (row ≤ 2) get a golden tint to signal importance
  const isHigh       = y <= 2;
  const grassColor   = isHigh ? '#4a9e8a' : '#5a9e3c';
  const grassTop     = isHigh ? '#5ec4a8' : '#6db848';
  const pillarColor  = isHigh ? '#7a5036' : '#8B6F3E';
  return (
    <>
      {/* Pillar body */}
      <div style={{ position: 'absolute', left, top, width, height: groundPx - top, backgroundColor: pillarColor, zIndex: 2 }} />
      {/* Grass surface */}
      <div style={{ position: 'absolute', left, top: top - 3, width, height: 14, backgroundColor: grassColor, borderRadius: '6px 6px 0 0', zIndex: 3 }} />
      <div style={{ position: 'absolute', left: left + 2, top: top - 3, width: width - 4, height: 6, backgroundColor: grassTop, borderRadius: '6px 6px 0 0', zIndex: 3 }} />
      {/* Vertical seams */}
      {Array.from({ length: x2 - x1 }).map((_, i) => (
        <div key={i} style={{ position: 'absolute', left: (x1 + i + 1) * CW, top: top + 14, width: 1, height: groundPx - top - 14, backgroundColor: 'rgba(0,0,0,0.12)', zIndex: 3 }} />
      ))}
      {/* High platform glow + "reach me!" indicator */}
      {isHigh && (
        <>
          <div style={{ position: 'absolute', left: left - 2, top: top - 3, width: width + 4, height: 8, borderRadius: 6, boxShadow: '0 0 12px 4px rgba(94,196,168,0.5)', zIndex: 3, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: left + width / 2 - 10, top: top - 28, fontSize: 16, zIndex: 6, animation: 'dotBounce 1.2s ease-in-out infinite', pointerEvents: 'none' }}>⬆</div>
        </>
      )}
    </>
  );
}

// ─── Cloud decoration ─────────────────────────────────────────────────────────
function Cloud({ left, top, scale = 1 }) {
  return (
    <div style={{ position: 'absolute', left, top, zIndex: 1, opacity: 0.55, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
      <div style={{ position: 'relative', width: 60, height: 30 }}>
        <div style={{ position: 'absolute', left: 0, top: 10, width: 60, height: 22, backgroundColor: 'white', borderRadius: 12 }} />
        <div style={{ position: 'absolute', left: 10, top: 0, width: 34, height: 26, backgroundColor: 'white', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', left: 30, top: 4, width: 26, height: 20, backgroundColor: 'white', borderRadius: '50%' }} />
      </div>
    </div>
  );
}

// ─── Main GameScene ───────────────────────────────────────────────────────────
export default function GameScene({ state, level, thinkingAgents = new Set(), motionBlend = null, animFrame = 0 }) {
  if (motionBlend) void animFrame;

  const platforms = level.platforms || [];
  const pits      = level.pits      || [];
  const gY        = level.groundY   ?? (level.gridRows - 1);
  const sceneW    = level.gridCols  * CW;
  const groundPx  = gY * CH;
  const sceneH    = groundPx + 68;
  const exitCol   = level.goalCol;
  const exitPx    = exitCol * CW;

  const pitKey = pits.length ? pits.join(',') : '';
  const pitRangeList = useMemo(() => pitRanges(pits), [pitKey]);

  // Single shared blink state — all skull tiles read from this so they stay in sync
  const [skullBright, setSkullBright] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setSkullBright(v => !v), 600);
    return () => clearInterval(id);
  }, []);

  const containerRef = useRef(null);

  const vState = state ? visualWorldState(state, motionBlend) : null;

  // ── Auto-scroll: keep leading agent ~35% from left of viewport ────────────
  const agentColsKey = state ? state.agents.map(a => a.col).join(',') : '';
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !state) return;
    const leadCol = Math.max(...state.agents.map(a => a.col));
    const leadPx  = leadCol * CW + CW / 2;
    const viewW   = el.clientWidth;
    const target  = Math.max(0, Math.min(leadPx - viewW * 0.35, sceneW - viewW));
    el.scrollTo({ left: target, behavior: 'smooth' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentColsKey]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const objLeft   = (col, w = CW) => col * CW + (CW - w) / 2;
  const objBottom = (row)          => sceneH - row * CH;

  if (!state || !vState) return null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'relative',
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: '0 6px 32px rgba(0,0,0,0.2)',
      userSelect: 'none',
    }}>
      {/* ── Horizontally scrollable scene ──────────────────────────────── */}
      <div
        ref={containerRef}
        style={{
          overflowX: 'auto',
          overflowY: 'hidden',
          height: sceneH,
          width: '100%',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0,0,0,0.18) transparent',
        }}
      >
      <div style={{
        position: 'relative',
        width: sceneW,
        height: sceneH,
        flexShrink: 0,
      }}>

        {/* Sky gradient */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,#b8e0ff 0%,#ddf0ff 70%,#eef7ff 100%)', zIndex: 0 }} />

        {/* Clouds */}
        <Cloud left={sceneW * 0.06}  top={12}  scale={1.1} />
        <Cloud left={sceneW * 0.28}  top={28}  scale={0.7} />
        <Cloud left={sceneW * 0.55}  top={10}  scale={1.3} />
        <Cloud left={sceneW * 0.78}  top={22}  scale={0.85} />

        {/* Exit column (Pico Park: one room past the door — orange floor cue) */}
        <div style={{
          position: 'absolute', left: exitPx, top: groundPx - 4,
          width: CW, height: sceneH - groundPx + 4,
          background: 'linear-gradient(180deg, rgba(255,220,170,0.35) 0%, #e8734a 55%, #c45a2e 100%)',
          borderLeft: '3px solid #b45309',
          borderRight: '3px solid #b45309',
          zIndex: 1,
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', left: exitPx + 4, top: groundPx - 36, zIndex: 6,
          fontSize: 9, fontWeight: 900, color: '#7c2d12', letterSpacing: 1,
          backgroundColor: 'rgba(255,255,255,0.85)', padding: '2px 6px', borderRadius: 4,
          border: '2px solid #e8734a',
        }}>EXIT</div>

        {/* Platforms */}
        {platforms.map((p, i) => <PlatformBlock key={i} {...p} groundPx={groundPx} />)}

        {/* Ground (with gaps at pit cols) */}
        <GroundStrip sceneW={sceneW} sceneH={sceneH} groundPx={groundPx} pits={pits} />

        {/* ── Pits — tall rectangle skull blocks flush to scene bottom ─────── */}
        {pitRangeList.map((r, i) => (
          <React.Fragment key={i}>
            {Array.from({ length: r.x2 - r.x1 + 1 }).map((_, ci) => (
              <div key={ci} style={{
                position: 'absolute',
                left: (r.x1 + ci) * CW + 2,
                top: groundPx - 2,
                width: CW - 4,
                height: sceneH - groundPx + 4,
                background: 'linear-gradient(180deg,#1a0a0a 0%,#2d1010 60%,#1a0a0a 100%)',
                borderRadius: '6px 6px 0 0',
                border: '2px solid #6b1a1a',
                borderBottom: 'none',
                boxShadow: '0 0 10px 2px rgba(180,30,30,0.45), inset 0 0 8px rgba(0,0,0,0.6)',
                zIndex: 5,
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                paddingTop: 6,
                fontSize: 22,
                opacity: skullBright ? 1 : 0.35,
                transition: 'opacity 0.25s ease-in-out',
              }}>☠️</div>
            ))}
          </React.Fragment>
        ))}

        {/* ── Pressure plate ────────────────────────────────────────────── */}
        {vState.plate && (
          <div style={{
            position: 'absolute',
            left: objLeft(vState.plate.col, CW * 0.75),
            bottom: objBottom(vState.plate.row) - 4,
            width: CW * 0.75, height: 10,
            backgroundColor: vState.plate.activated ? '#7C3AED' : '#A78BFA',
            border: `2px solid ${vState.plate.activated ? '#5B21B6' : '#8B5CF6'}`,
            borderRadius: 4, zIndex: 6,
            transition: 'background-color 0.3s',
            boxShadow: vState.plate.activated ? '0 0 14px #7C3AED99' : 'none',
          }} />
        )}

        {/* ── Box ──────────────────────────────────────────────────────── */}
        {vState.box && (
          <div style={{
            position: 'absolute',
            left: objLeft(vState.box.col, 38),
            bottom: objBottom(vState.box.row) - 2,
            width: 38, height: 38,
            backgroundColor: '#f59e0b', border: '3px solid #d97706',
            borderRadius: 5, zIndex: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, boxShadow: '2px 3px 0 #b45309',
          }}>📦</div>
        )}

        {/* ── Key (golden, spins when uncollected) ──────────────────────── */}
        {vState.key && !vState.key.collected && (
          <div style={{
            position: 'absolute',
            left:   objLeft(vState.key.col, 32),
            bottom: objBottom(vState.key.row) + 6,
            width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22,
            filter: 'drop-shadow(0 0 8px #fbbf24) drop-shadow(0 0 3px #f59e0b)',
            animation: 'keySpin 3s linear infinite',
            zIndex: 8,
          }}>🔑</div>
        )}

        {/* Collected key flash */}
        {vState.key?.collected && (
          <div style={{
            position: 'absolute',
            left:   objLeft(vState.key.col, 32),
            bottom: objBottom(vState.key.row) + 6,
            width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, opacity: 0.35,
            zIndex: 8,
          }}>✨</div>
        )}

        {/* Key HUD badge — positioned in scrolling space but will be moved to viewport overlay */}

        {/* ── Buttons ───────────────────────────────────────────────────── */}
        {(vState.buttons || []).map(btn => (
          <div key={btn.id} style={{
            position: 'absolute',
            left: objLeft(btn.col, 38),
            // Pressed = sunk 5px down; unpressed = raised up
            bottom: btn.pressed ? objBottom(btn.row) - 7 : objBottom(btn.row) - 2,
            width: 38,
            height: btn.pressed ? 10 : 14,
            backgroundColor: btn.pressed ? '#d97706' : '#3b82f6',
            border: `3px solid ${btn.pressed ? '#92400e' : '#2563eb'}`,
            borderRadius: btn.pressed ? '2px 2px 3px 3px' : '5px 5px 2px 2px',
            // Raised = bottom shadow; pressed = inset shadow (sunken look)
            boxShadow: btn.pressed
              ? 'inset 0 3px 6px rgba(0,0,0,0.45), 0 0 14px #f59e0b99'
              : '0 5px 0 #1d4ed8',
            zIndex: 7,
            transition: 'all 0.12s ease-out',
          }}>
            <div style={{
              position: 'absolute', top: btn.pressed ? -8 : -10, left: '50%', transform: 'translateX(-50%)',
              fontSize: 10, fontWeight: 800,
              color: btn.pressed ? '#92400e' : '#2563eb',
              transition: 'all 0.12s',
            }}>{btn.pressed ? '✓' : '▲'}</div>
          </div>
        ))}

        {/* ── Door (Pico-style wood arch) ───────────────────────────────── */}
        {vState.door && !vState.door.open && (
          <div style={{
            position: 'absolute', left: vState.door.col * CW + 4, top: groundPx - CW * 1.05,
            width: CW - 8, height: CW * 1.05, zIndex: 9, pointerEvents: 'none',
          }}>
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(180deg,#8B5A2B 0%,#5D3A1A 100%)',
              borderRadius: '14px 14px 4px 4px',
              border: '3px solid #3d2410',
              boxShadow: 'inset 0 -8px 0 rgba(0,0,0,0.15)',
            }} />
            <div style={{
              position: 'absolute', left: '12%', right: '12%', top: '18%', bottom: '12%',
              background: 'linear-gradient(180deg,#1a1208 0%,#0d0804 100%)',
              borderRadius: 8,
              border: '2px solid #2a1810',
            }} />
            <div style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', fontSize: 11, fontWeight: 900, color: '#5D3A1A' }}>🔒</div>
          </div>
        )}
        {vState.door?.open && (
          <div style={{
            position: 'absolute', left: vState.door.col * CW + 4, top: groundPx - CW * 1.05,
            width: CW - 8, height: CW * 1.05, zIndex: 9, pointerEvents: 'none',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4,
          }}>
            <div style={{
              width: '100%', height: '100%',
              background: 'linear-gradient(180deg,#a07040 0%,#6b4423 100%)',
              borderRadius: '14px 14px 4px 4px',
              border: '3px dashed rgba(255,255,255,0.45)',
              boxShadow: 'inset 0 0 20px rgba(255,200,120,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, opacity: 0.95,
            }}>🚪</div>
          </div>
        )}

        {/* ── Timing Gate ───────────────────────────────────────────────── */}
        {vState.gate && (
          <div style={{
            position: 'absolute', left: vState.gate.col * CW, top: 0,
            width: CW, height: groundPx,
            backgroundColor: vState.gate.open ? 'rgba(245,158,11,0.07)' : 'rgba(245,158,11,0.88)',
            border: vState.gate.open ? '2px dashed rgba(245,158,11,0.5)' : '3px solid #d97706',
            zIndex: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            animation: vState.gate.open ? 'none' : 'gateFlicker 1.5s ease-in-out infinite',
            transition: 'background-color 0.12s',
          }}>
            {vState.gate.open ? '↔' : '⚡'}
          </div>
        )}

        {/* ── Button-Gate (latch-button controlled, permanent) ──────────── */}
        {vState.buttonGate && (
          <div style={{
            position: 'absolute', left: vState.buttonGate.col * CW, top: 0,
            width: CW, height: groundPx,
            backgroundColor: vState.buttonGate.open
              ? 'rgba(139,92,246,0.06)'
              : 'rgba(109,40,217,0.85)',
            border: vState.buttonGate.open
              ? '2px dashed rgba(139,92,246,0.45)'
              : '3px solid #7c3aed',
            zIndex: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            transition: 'all 0.25s',
          }}>
            {vState.buttonGate.open ? '⛩' : '🔒'}
          </div>
        )}

        {/* ── Hazard tiles — same tall rectangle as pit blocks ─────────── */}
        {(level.hazards || []).map((h, i) => (
          <div
            key={`hz${i}`}
            style={{
              position: 'absolute',
              left: h.col * CW + 2,
              top: h.row * CH - 2,
              width: CW - 4,
              height: sceneH - h.row * CH + 2,
              background: 'linear-gradient(180deg,#1a0a0a 0%,#2d1010 60%,#1a0a0a 100%)',
              borderRadius: '6px 6px 0 0',
              border: '2px solid #6b1a1a',
              borderBottom: 'none',
              boxShadow: '0 0 10px 2px rgba(180,30,30,0.45), inset 0 0 8px rgba(0,0,0,0.6)',
              zIndex: 5,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              paddingTop: 6,
              fontSize: 22,
              animation: 'gateFlicker 2s ease-in-out infinite',
            }}
          >☠️</div>
        ))}

        {/* ── Agents ────────────────────────────────────────────────────── */}

        {state.agents.map(agent => {
          const L          = agentRenderLayout(agent, motionBlend);
          const isFell     = agent.lastAction === 'fell_in_pit';
          const isThinking = thinkingAgents.has(agent.id);
          const endA       = motionBlend?.toState?.agents?.find(a => a.id === agent.id);

          // Disappear once the agent is committed to the exit zone (any col >= goalCol)
          const committedAtGoal = agent.col >= level.goalCol;
          // During a blend where this agent is stepping INTO the exit, still show them in motion
          const blendingIntoGoal = motionBlend && (endA?.col ?? 0) >= level.goalCol && agent.col < level.goalCol;
          if (committedAtGoal && !blendingIntoGoal) return null;

          const gapJump    = L.airborne && L.displayAction === 'jump';
          const shadowGroundY = L.shadowRow * CH;
          const heightAbove   = gapJump ? (shadowGroundY - L.y - CAT_SIZE) : 0;
          const shadowScale   = gapJump ? Math.max(0.22, 1 - heightAbove / (GAP_JUMP_ARC_PEAK * 1.15)) : 1;

          // Fade out during the final step into the exit
          const fadingOut = blendingIntoGoal;
          const rawT = motionBlend && fadingOut
            ? Math.max(0, Math.min(1, (performance.now() - motionBlend.startTime) / motionBlend.duration))
            : 0;
          const opacity = fadingOut ? Math.max(0, 1 - rawT * 1.6) : 1;

          return (
            <React.Fragment key={agent.id}>
              {gapJump && (
                <div style={{
                  position: 'absolute',
                  left: L.shadowCol * CW + (CW - CAT_SIZE * 0.8) / 2 + (L.shadowBias ?? 0) * STACK_BIAS_X,
                  top: shadowGroundY - 6,
                  width: CAT_SIZE * 0.8,
                  height: 8,
                  backgroundColor: `rgba(0,0,0,${0.22 * shadowScale})`,
                  borderRadius: '50%',
                  transform: `scaleX(${shadowScale})`,
                  filter: 'blur(3px)',
                  zIndex: 9,
                  transformOrigin: 'center',
                }} />
              )}
              <div
                className={isFell ? 'pit-fall' : ''}
                style={{
                  position: 'absolute',
                  left: L.x,
                  top: Math.max(-CAT_SIZE, L.y),
                  width: CAT_SIZE,
                  zIndex: 10,
                  transition: 'none',
                  opacity,
                  transform: fadingOut ? `scale(${Math.max(0.3, 1 - rawT * 0.7)})` : undefined,
                  transformOrigin: 'bottom center',
                }}
              >
                <PicoCat
                  color={agent.color || '#888'}
                  size={CAT_SIZE}
                  bouncing={false}
                  goal={false}
                />

                <div style={{
                  position: 'absolute', bottom: -14, left: '50%', transform: 'translateX(-50%)',
                  fontSize: 10, fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap',
                  backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: 4, padding: '0 3px',
                  border: `1px solid ${agent.color}`, lineHeight: '14px',
                }}>{agent.id}</div>

                {gapJump && (
                  <div style={{ position: 'absolute', top: -20, left: '50%', transform: 'translateX(-50%)', fontSize: 16 }}>🦘</div>
                )}
                {isFell && (
                  <div style={{ position: 'absolute', top: -20, left: '50%', transform: 'translateX(-50%)', fontSize: 16 }}>💀</div>
                )}
                {isThinking && !motionBlend && (
                  <div style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', fontSize: 13, animation: 'dotBounce 1s ease-in-out infinite' }}>💭</div>
                )}
              </div>
            </React.Fragment>
          );
        })}

        {/* Fail overlay */}
        {state.levelFailed && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 21,
            backgroundColor: 'rgba(127,29,29,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8,
          }}>
            <div style={{ fontSize: 44 }}>💀</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', backgroundColor: 'rgba(185,28,28,0.95)', padding: '10px 18px', borderRadius: 12, border: '3px solid #7f1d1d', textAlign: 'center', maxWidth: '88%' }}>
              {state.failMessage || 'Eliminated'}
            </div>
          </div>
        )}

        {/* Win overlay */}
        {state.levelComplete && !state.levelFailed && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 20,
            backgroundColor: 'rgba(76,175,80,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8,
          }}>
            <div style={{ fontSize: 52, animation: 'winPop 0.6s ease-in-out infinite alternate' }}>🎉</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: '#166534', backgroundColor: 'rgba(255,255,255,0.92)', padding: '8px 20px', borderRadius: 12, border: '3px solid #22c55e' }}>LEVEL CLEAR!</div>
          </div>
        )}
      </div>   {/* ← closes position:relative scene div */}
      </div>   {/* ← closes scroll container (containerRef) */}

      {/* ── HUD overlay: always visible regardless of scroll ────────────── */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 30 }}>
        {/* Key status badge */}
        {vState.key && (
          <div style={{
            position: 'absolute', top: 10, left: 10,
            backgroundColor: vState.key.collected ? 'rgba(34,197,94,0.95)' : 'rgba(251,191,36,0.95)',
            color: vState.key.collected ? '#fff' : '#78350f',
            fontSize: 11, fontWeight: 800,
            padding: '4px 10px', borderRadius: 10,
            border: `2px solid ${vState.key.collected ? '#16a34a' : '#d97706'}`,
            boxShadow: vState.key.collected ? '0 0 12px #22c55e55' : '0 0 8px #fbbf2455',
          }}>
            {vState.key.collected
              ? `🔑 KEY — collected by ${vState.key.collectedBy}!`
              : '🔑 KEY — grab it to unlock the door'}
          </div>
        )}

        {/* Progress bar */}
        <div style={{ position: 'absolute', bottom: 6, left: 12, right: 12, height: 4, backgroundColor: 'rgba(0,0,0,0.12)', borderRadius: 3 }}>
          {state.agents.map(a => (
            <div key={a.id} style={{
              position: 'absolute', top: 0, left: 0,
              width: `${Math.min(100, (a.col / level.gridCols) * 100)}%`,
              height: 4, backgroundColor: a.color, borderRadius: 3,
              transition: 'width 0.45s ease', opacity: 0.7,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}
