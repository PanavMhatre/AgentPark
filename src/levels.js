// ══════════════════════════════════════════════════════════════════════════════
// AGENT PARK — Level Definitions
// ══════════════════════════════════════════════════════════════════════════════

export const LEVELS = [
  // ────────────────────────────────────────────────────────────────────────────
  // LEVEL 1 — DUAL SWITCH (harder: hazard skull on the path)
  // ────────────────────────────────────────────────────────────────────────────
  {
    id: 1,
    name: 'DUAL SWITCH',
    subtitle: 'Press both pads. Dodge the skull. Key. Door. Exit.',
    description: 'Two latch-pads open a sealed gate. But now a skull hazard blocks the path to the key — agents must jump over it. Coordinate who presses each pad and time the crossing.',
    objective: 'Latch both pads (jump-activate) → gate opens → jump skull hazard → key → door → all exit.',
    mechanics: [
      { icon: '▲', label: 'Latch pads', desc: 'Cols 4 & 5 — MUST be jumped onto (jump from 2 cols before, or move_up on-pad). Walking does NOT activate.' },
      { icon: '⛩', label: 'Button-gate', desc: 'Col 7 — sealed until both pads latched.' },
      { icon: '☠', label: 'Skull hazard', desc: 'Col 9 — instant death. Jump from col 8 to col 10 to clear it.' },
      { icon: '🔑', label: 'Key', desc: 'Col 11 ground — walk onto it.' },
      { icon: '🚪', label: 'Door', desc: 'Col 12 — opens with key.' },
      { icon: '🧡', label: 'Exit', desc: 'Col 13.' },
    ],
    gridCols: 15,
    gridRows: 6,
    groundY: 5,
    platforms: [],
    pits: [],
    hazards: [{ col: 9, row: 5 }],
    goalCol: 13,
    initialState: {
      agents: [
        { id: 'A', col: 0, row: 5, task: '', lastAction: '', color: '#ff6b6b' },
        { id: 'B', col: 1, row: 5, task: '', lastAction: '', color: '#4ecdc4' },
        { id: 'C', col: 2, row: 5, task: '', lastAction: '', color: '#ffe66d' },
        { id: 'D', col: 3, row: 5, task: '', lastAction: '', color: '#a8e6cf' },
      ],
      buttons: [
        { id: 'btn1', col: 4, row: 5, pressed: false, pressedBy: null, latch: true },
        { id: 'btn2', col: 5, row: 5, pressed: false, pressedBy: null, latch: true },
      ],
      buttonGate: { col: 7, open: false },
      key: { col: 11, row: 5, collected: false, collectedBy: null },
      door: { col: 12, row: 0, open: false, height: 6 },
      hazards: [{ col: 9, row: 5 }],
      box: null, plate: null, gate: null, pits: [],
      agentsAtGoal: [], levelComplete: false, levelFailed: false, failMessage: '', tick: 0, log: [],
    },
    rules: `LEVEL 1 — DUAL SWITCH:
- Ground row=5. No pits. No timing gate.
- btn1 at col 4, btn2 at col 5 (adjacent!).
  ACTIVATION: jump from padCol-2. btn1 → jump from col 2. btn2 → jump from col 3.
  Walking does NOT activate pads.
- CRITICAL SEQUENCING RULE: btn1 (col 4) sits in the mid-path of any jump from col 3 to btn2 (col 5).
  Therefore btn1 MUST be pressed BEFORE btn2 can be activated.
  CORRECT ORDER: (1) one agent jumps col 2→col 4 to press btn1, (2) that agent vacates col 4 (move_left), (3) another agent jumps col 3→col 5 to press btn2. Do NOT attempt both simultaneously.
- Button-gate col=7 opens when both pads latched.
- SKULL HAZARD col=9: instant death. Jump from col 8 to clear.
- Key at col 11, Door at col 12. WIN: key collected, all agents col>=13.`,
  },

  // ────────────────────────────────────────────────────────────────────────────
  // LEVEL 2 — THE BOOST (harder: 2 pits, elevated platform boost, skull hazard)
  // ────────────────────────────────────────────────────────────────────────────
  {
    id: 2,
    name: 'THE BOOST',
    subtitle: 'Pit. Stack for the elevated key. Second pit. Skull. Door. Exit.',
    description: 'Two pits and an elevated key. The key sits on a ledge two rows above ground, reachable only by a 2-agent boost stack. After collecting, another pit and a skull hazard block the way out.',
    objective: 'Jump pit → 2-agent boost for key → jump 2nd pit → jump skull → door → all exit.',
    mechanics: [
      { icon: '🕳', label: 'Pit col 5', desc: 'Jump from col 4 to land on elevated platform (row 3).' },
      { icon: '👥', label: '2-Agent Boost', desc: 'Stack 2 cats at key col (8). Base row 5, top row 4. Top uses move_up to reach row 3 (key ledge).' },
      { icon: '🔑', label: 'Key', desc: 'Col 8 row 3 on the ledge.' },
      { icon: '🕳', label: 'Pit col 11', desc: 'Jump from platform col 10 to col 12.' },
      { icon: '☠', label: 'Skull col 13', desc: 'Jump from col 12 to col 14 to clear.' },
      { icon: '🚪', label: 'Door', desc: 'Col 14 — opens with key.' },
      { icon: '🧡', label: 'Exit', desc: 'Col 15.' },
    ],
    gridCols: 16,
    gridRows: 6,
    groundY: 5,
    platforms: [{ x1: 6, x2: 10, y: 3 }],
    pits: [5, 11],
    hazards: [{ col: 13, row: 5 }],
    goalCol: 15,
    initialState: {
      agents: [
        { id: 'A', col: 0, row: 5, task: '', lastAction: '', color: '#ff6b6b' },
        { id: 'B', col: 1, row: 5, task: '', lastAction: '', color: '#4ecdc4' },
        { id: 'C', col: 2, row: 5, task: '', lastAction: '', color: '#ffe66d' },
        { id: 'D', col: 3, row: 5, task: '', lastAction: '', color: '#a8e6cf' },
      ],
      key: { col: 8, row: 3, collected: false, collectedBy: null },
      door: { col: 14, row: 0, open: false, height: 6 },
      hazards: [{ col: 13, row: 5 }],
      buttons: [], box: null, plate: null, gate: null, buttonGate: null, pits: [5, 11],
      agentsAtGoal: [], levelComplete: false, levelFailed: false, failMessage: '', tick: 0, log: [],
    },
    rules: `LEVEL 2 — THE BOOST:
- Ground row=5. Pits at col 5 and col 11 (TEAM RESTART if any agent falls in).
- Platform cols 6-10 at row 3 — 2 rows above ground.
- Jump pit col 5: stand at col 4, jump → land at col 6 (on ground row 5 below the platform).
- BOOST: 2 agents stack at col 8. Base at (8,5), top at (8,4). Top uses move_up → lands on row 3 (platform). Key at (8,3) auto-collected on landing.
- After key: move to col 10 (end of platform area). Jump pit col 11: from col 10, jump → col 12.
- SKULL HAZARD at (13,5): jump from col 12 to col 14 to clear it.
  If door (col 14) is CLOSED: jump is blocked — wait at col 12 until key is collected and door opens.
- Door col=14 opens when key collected. WIN: all agents col >= 15.`,
  },

  // ────────────────────────────────────────────────────────────────────────────
  // LEVEL 3 — DEATH MARCH (much longer: 2 skulls, 2 pits, latch, timing gate)
  // ────────────────────────────────────────────────────────────────────────────
  {
    id: 3,
    name: 'DEATH MARCH',
    subtitle: 'Latch pad. Skulls. Pits. Lightning gate. Key. Door. Exit.',
    description: 'A brutal gauntlet. One latch-pad opens the button-gate. Then: skull hazard, pit, second skull, timing lightning gate (very short open window), another pit, and finally the key behind a locked door.',
    objective: 'Latch pad → gate → jump skull → jump pit → jump skull → time lightning → jump pit → key → door → exit.',
    mechanics: [
      { icon: '▲', label: 'Latch pad', desc: 'Col 4 — jump to activate (jump from col 2).' },
      { icon: '⛩', label: 'Button-gate', desc: 'Col 6 — opens after pad latched.' },
      { icon: '☠', label: 'Skull col 8', desc: 'Jump from col 7 to col 9.' },
      { icon: '🕳', label: 'Pit col 10', desc: 'Jump from col 9 to col 11.' },
      { icon: '☠', label: 'Skull col 12', desc: 'Jump from col 11 to col 13.' },
      { icon: '⚡', label: 'Lightning gate col 15', desc: 'Open only 2 ticks of every 8. Stand at col 14, wait for it.' },
      { icon: '🕳', label: 'Pit col 17', desc: 'Jump from col 16 to col 18.' },
      { icon: '🔑', label: 'Key', desc: 'Col 19 ground.' },
      { icon: '🚪', label: 'Door', desc: 'Col 20.' },
      { icon: '🧡', label: 'Exit', desc: 'Col 21.' },
    ],
    gridCols: 23,
    gridRows: 6,
    groundY: 5,
    platforms: [],
    pits: [10, 17],
    hazards: [{ col: 8, row: 5 }, { col: 12, row: 5 }],
    goalCol: 21,
    initialState: {
      agents: [
        { id: 'A', col: 0, row: 5, task: '', lastAction: '', color: '#ff6b6b' },
        { id: 'B', col: 1, row: 5, task: '', lastAction: '', color: '#4ecdc4' },
        { id: 'C', col: 2, row: 5, task: '', lastAction: '', color: '#ffe66d' },
        { id: 'D', col: 3, row: 5, task: '', lastAction: '', color: '#a8e6cf' },
      ],
      buttons: [
        { id: 'btn1', col: 4, row: 5, pressed: false, pressedBy: null, latch: true },
      ],
      buttonGate: { col: 6, open: false },
      gate: { col: 15, rowStart: 0, rowEnd: 5, open: false, period: 8, openFor: 4 },
      key: { col: 19, row: 5, collected: false, collectedBy: null },
      door: { col: 20, row: 0, open: false, height: 6 },
      hazards: [{ col: 8, row: 5 }, { col: 12, row: 5 }],
      box: null, plate: null, pits: [10, 17],
      agentsAtGoal: [], levelComplete: false, levelFailed: false, failMessage: '', tick: 0, log: [],
    },
    rules: `LEVEL 3 — DEATH MARCH:
- Ground row=5. Pits at cols 10 and 17 (TEAM RESTART on fall). No platforms.
- TEAM DEATH: falling in pit OR entering closed lightning gate = entire team restarts.
- Latch-pad btn1 at (4,5): jump from col 2 to activate, OR use move_up while standing on col 4.
- Button-gate col=6: opens permanently after pad latched.
- SKULL HAZARD at (8,5): jump from col 7 to col 9. Do NOT walk to col 8.
- Pit col=10: jump from col 9 to col 11.
- SKULL HAZARD at (12,5): jump from col 11 to col 13.
- Lightning gate col=15: period=8, open for 4 ticks. Open when tick%8 >= 4. Stand at col 14, wait.
  DANGER: entering col 15 while closed = INSTANT TEAM RESTART. Wait patiently.
- Pit col=17: jump from col 16 to col 18.
- Key at (19,5). Door col=20. WIN: key + all col >= 21.`,
  },

  // ────────────────────────────────────────────────────────────────────────────
  // LEVEL 4 — FULL COMBO (insanely hard: everything at once, long level)
  // ────────────────────────────────────────────────────────────────────────────
  {
    id: 4,
    name: 'FULL COMBO',
    subtitle: '2 pads. Skull. Lightning. 3 pits. Boost key. Skull. Door. Exit.',
    description: 'All mechanics at maximum difficulty. Two latch-pads, a skull, a tight lightning gate, three pits, a 2-agent boost for an elevated key, another skull, and a long run to the exit.',
    objective: '2 latch pads → gate → pit → skull → lightning gate → 2 more pits (with boost) → skull → door → exit.',
    mechanics: [
      { icon: '▲', label: 'Two latch pads', desc: 'Cols 5 & 6. D jumps from col 3, C walks to col 4 then jumps.' },
      { icon: '⛩', label: 'Button-gate', desc: 'Col 8 — needs both pads.' },
      { icon: '🕳', label: 'Pit col 9', desc: 'Jump from col 8 to col 10.' },
      { icon: '☠', label: 'Skull col 11', desc: 'Jump from col 10 to col 12.' },
      { icon: '⚡', label: 'Lightning gate col 14', desc: 'Period 5, open 2 ticks. Extremely tight. Wait at col 13.' },
      { icon: '🕳', label: 'Pit col 15', desc: 'Jump from col 14 (right after gate) to col 16.' },
      { icon: '👥', label: '2-Agent Boost', desc: 'Stack at col 18. Platform at row 3, cols 16-20. Top uses move_up to reach key at (18,3).' },
      { icon: '🕳', label: 'Pit col 21', desc: 'Jump from col 20 to col 22.' },
      { icon: '☠', label: 'Skull col 23', desc: 'Jump from col 22 to col 24.' },
      { icon: '🚪', label: 'Door', desc: 'Col 24 — opens with key.' },
      { icon: '🧡', label: 'Exit', desc: 'Col 25.' },
    ],
    gridCols: 27,
    gridRows: 6,
    groundY: 5,
    platforms: [{ x1: 16, x2: 20, y: 3 }],
    pits: [9, 15, 21],
    hazards: [{ col: 11, row: 5 }, { col: 23, row: 5 }],
    goalCol: 25,
    initialState: {
      agents: [
        { id: 'A', col: 0, row: 5, task: '', lastAction: '', color: '#ff6b6b' },
        { id: 'B', col: 1, row: 5, task: '', lastAction: '', color: '#4ecdc4' },
        { id: 'C', col: 2, row: 5, task: '', lastAction: '', color: '#ffe66d' },
        { id: 'D', col: 3, row: 5, task: '', lastAction: '', color: '#a8e6cf' },
      ],
      buttons: [
        { id: 'btn1', col: 5, row: 5, pressed: false, pressedBy: null, latch: true },
        { id: 'btn2', col: 6, row: 5, pressed: false, pressedBy: null, latch: true },
      ],
      buttonGate: { col: 8, open: false },
      gate: { col: 14, rowStart: 0, rowEnd: 5, open: false, period: 8, openFor: 3 },
      key: { col: 18, row: 3, collected: false, collectedBy: null },
      door: { col: 24, row: 0, open: false, height: 6 },
      hazards: [{ col: 11, row: 5 }, { col: 23, row: 5 }],
      box: null, plate: null, pits: [9, 15, 21],
      agentsAtGoal: [], levelComplete: false, levelFailed: false, failMessage: '', tick: 0, log: [],
    },
    rules: `LEVEL 4 — FULL COMBO:
- Ground row=5. Pits at cols 9, 15, 21 (TEAM RESTART on fall). Platform cols 16-20 at row 3.
- TEAM DEATH: pit OR closed lightning gate = restart.
- Latch pads at (5,5) and (6,5). D starts at col 3 (jumpFromCol for btn1=5): immediately jump.
  C starts at col 2, walk to col 4 (jumpFromCol for btn2=6), then jump.
- Button-gate col=8 opens when both pads latched.
- Pit col=9: jump from col 8 to col 10.
- SKULL HAZARD at (11,5): jump from col 10 to col 12.
- Lightning gate col=14: period=8, openFor=3. Open when tick%8 >= 5. TIGHT.
  Wait at col 13. When gate opens, move through col 14.
- Pit col=15: immediately after gate — jump from col 14 to col 16.
- Platform at row 3, cols 16-20. Agents land on ground (row 5) BELOW the platform.
  BOOST at col 18: 2 agents stack at (18,5) and (18,4). Top uses move_up → row 3 (key at (18,3)).
  After boost: boostee uses move_down to return to ground, then continue.
- Pit col=21: jump from col 20 to col 22.
- SKULL HAZARD at (23,5): jump from col 22 to col 24.
  Door (col 24) must be OPEN (key collected) for this jump to land. Wait if needed.
- WIN: key collected AND all agents col >= 25.`,
  },
];
