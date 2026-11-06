// Whole-day UTC date arithmetic on ISO strings. Engines never read the clock (D3), so dates come
// only from the input and are converted without constructing Date objects.

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for an ISO date or date-time; NaN when unparseable. */
export function dayOf(iso: string): number {
  return Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

/** ISO date for a day number (civil-from-days, H. Hinnant). */
export function isoOf(day: number): string {
  const z = day + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) =>
  [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 30;

/**
 * First day of a lookback of `months` ending on `asOf` inclusive: the day after the same
 * calendar day `months` earlier, clamped to the end of a shorter month. 6 months to 31 October
 * starts on 1 May.
 */
export function lookbackStart(asOf: string, months: number): number {
  const [y = 0, m = 1, d = 1] = asOf.slice(0, 10).split("-").map(Number);
  const index = y * 12 + (m - 1) - months;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  const td = Math.min(d, daysIn(ty, tm));
  const iso = `${String(ty).padStart(4, "0")}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
  return dayOf(iso) + 1;
}

export const DAYS_PER_MONTH = 30.4375;
