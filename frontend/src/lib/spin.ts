/** One turn in 1.8 s: 33 1/3 rpm. */
export const SPIN_DEG_PER_SECOND = 360 / 1.8;
/** The platter gains or loses about two thirds of the missing speed in this many seconds. */
export const SPIN_TAU = 0.6;

export interface Spin { angle: number; speed: number }

/**
 * The record's platter, one step: its speed eases towards full speed (playing) or zero (paused), and the angle goes on from where it was,
 * so a pause stops it wherever it has got to and a resume continues from there. Below half a degree per second it counts as stopped.
 */
export function stepSpin(s: Spin, dt: number, on: boolean): Spin {
  const goal = on ? SPIN_DEG_PER_SECOND : 0;
  let speed = s.speed + (goal - s.speed) * (1 - Math.exp(-dt / SPIN_TAU));
  if (!on && speed < 0.5) speed = 0;
  return { angle: (s.angle + speed * dt) % 360, speed };
}
