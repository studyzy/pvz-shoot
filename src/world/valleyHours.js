// Time-of-day for the 'valley' map. Pure functions so they can be unit-tested in jsdom.
// The four keys mirror the painted-valley demo (T cycles them there); 1-4 were deliberately
// NOT reused here because those digits are pvz-shoot's five weapon slots.

export const VALLEY_TIMES = Object.freeze([
  { hour: 12.5, name: '正午' },
  { hour: 15.5, name: '午后' },
  { hour: 19.0, name: '黄金时刻' },
  { hour: 20.3, name: '日落' },
]);

export const VALLEY_NOON = 12.0;
export const VALLEY_START_HOUR = 15.5;
export const VALLEY_SUNSET = 20.4;
// A visible change over a typical match (about 4 minutes from the start hour to sunset).
export const VALLEY_DRIFT = (VALLEY_SUNSET - VALLEY_START_HOUR) / (4 * 60);

export function clampValleyHour(hour) {
  return Math.max(VALLEY_NOON, Math.min(VALLEY_SUNSET, hour));
}

/** Next preset after the current hour, wrapping back to noon. */
export function nextValleyTime(hour) {
  const i = VALLEY_TIMES.findIndex((t) => t.hour > hour + 0.05);
  return VALLEY_TIMES[i === -1 ? 0 : i].hour;
}

export function valleyTimeName(hour) {
  let best = VALLEY_TIMES[0];
  for (const t of VALLEY_TIMES) {
    if (Math.abs(t.hour - hour) < Math.abs(best.hour - hour)) best = t;
  }
  return best.name;
}

// Requests coming from Controls / the HUD button.
export const VALLEY_TIME = Object.freeze({ NONE: 0, CYCLE: 1, DRIFT: 2, EARLIER: 3, LATER: 4 });
