// Durations for one discrete "step" — real-time sim interpolates smoothly across this window.
export const STEP_MS = {
  move_right: 380,
  move_left: 380,
  move_up: 780,
  move_down: 520,
  jump: 900,
  push_box: 380,
  wait: 0,
  fell_in_pit: 0,
  default: 400,
};

export function maxStepDurationMs(actions) {
  if (!actions?.length) return 0;
  const m = Math.max(...actions.map(a => {
    const base   = STEP_MS[a.action] ?? STEP_MS.default;
    const amount = (a.action === 'move_right' || a.action === 'move_left') ? Math.max(1, a.amount ?? 1) : 1;
    return base * amount;
  }), 0);
  return m < 12 ? 0 : m;
}
