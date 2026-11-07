// Roll-up classes (Amendment 2 §3, RU-1): which signals may move the roll-up at all. The full
// roll-up (Product Specification §7.5, RU-4 to RU-7) is phase 2 (D13). This is only the class
// rule every family relies on now: context, review_only, indicative and positive signals never
// move it, whatever their state. Pure (D3).
import type { Signal } from "../evidence/types.js";

const MOVES: ReadonlySet<string> = new Set(["knockout", "refer", "standard"]);

/** The signals that move the roll-up: amber or red in a knockout, refer or standard class. */
export function rollupMovers(signals: readonly Signal[]): { id: string; state: string }[] {
  return signals
    .filter((s) => MOVES.has(s.rollup_class) && (s.state === "amber" || s.state === "red"))
    .map((s) => ({ id: s.id, state: s.state }));
}
