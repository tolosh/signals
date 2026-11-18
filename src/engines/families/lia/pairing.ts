// SIG-42 ruling 1 of 16 November 2026 (comment 40327, on review 10): LIA's exact-name pairing is
// the best overall fit. Of every one-to-one pairing of found liabilities (left) with declarations
// (right) along the allowed edges, it takes:
//   1. the most pairs;
//   2. then the smallest total cost (the amount difference, in cents);
//   3. then the tie-break: the left side in its given order each takes the earliest right side,
//      in its given order, that still allows a pairing as good on 1 and 2 (or none, when none
//      does). The caller gives both sides in a fixed order that doesn't depend on input order.
// 1 and 2 are a minimum-cost maximum matching, found by successive shortest paths (Bellman-Ford,
// as costs on the residual graph can be negative); 3 re-solves with each choice fixed in turn.
// Exact for any size; the sides LIA passes are an applicant's liabilities and declarations.
// Pure: no clock, no randomness, relative imports (D3).

export type Edge = { left: number; right: number; cost: number };
type Best = { pairs: number; cost: number };

/** The most pairs, then the least total cost, using only the given sides and edges. */
function solve(nLeft: number, nRight: number, edges: readonly Edge[]): Best {
  // Nodes: source 0, left 1..nLeft, right nLeft+1..nLeft+nRight, sink nLeft+nRight+1.
  const sink = nLeft + nRight + 1;
  const to: number[] = [];
  const cap: number[] = [];
  const cost: number[] = [];
  const add = (a: number, b: number, c: number) => {
    to.push(b, a);
    cap.push(1, 0);
    cost.push(c, -c);
    from.push(a, b);
  };
  const from: number[] = [];
  for (let l = 0; l < nLeft; l++) add(0, 1 + l, 0);
  for (let r = 0; r < nRight; r++) add(1 + nLeft + r, sink, 0);
  for (const e of edges) add(1 + e.left, 1 + nLeft + e.right, e.cost);
  let pairs = 0;
  let total = 0;
  for (;;) {
    const dist = Array.from({ length: sink + 1 }, () => Infinity);
    const via = Array.from({ length: sink + 1 }, () => -1);
    dist[0] = 0;
    for (let round = 0; round <= sink; round++) {
      let changed = false;
      for (let k = 0; k < to.length; k++) {
        const a = from[k] as number;
        const b = to[k] as number;
        const d = (dist[a] as number) + (cost[k] as number);
        if ((cap[k] as number) > 0 && (dist[a] as number) < Infinity && d < (dist[b] as number)) {
          dist[b] = d;
          via[b] = k;
          changed = true;
        }
      }
      if (!changed) break;
    }
    if ((dist[sink] as number) === Infinity) break;
    for (let v = sink; v !== 0; v = from[via[v] as number] as number) {
      const k = via[v] as number;
      cap[k] = (cap[k] as number) - 1;
      cap[k ^ 1] = (cap[k ^ 1] as number) + 1;
    }
    pairs += 1;
    total += dist[sink] as number;
  }
  return { pairs, cost: total };
}

/** The chosen pairs, by ruling 1's three steps (above). */
export function bestPairing(
  nLeft: number,
  nRight: number,
  edges: readonly Edge[],
): { left: number; right: number }[] {
  const chosen: { left: number; right: number }[] = [];
  const takenLeft = new Set<number>();
  const takenRight = new Set<number>();
  const open = (es: readonly Edge[]) =>
    es.filter((e) => !takenLeft.has(e.left) && !takenRight.has(e.right));
  let target = solve(nLeft, nRight, edges);
  for (let l = 0; l < nLeft; l++) {
    const mine = open(edges)
      .filter((e) => e.left === l)
      .sort((a, b) => a.right - b.right);
    takenLeft.add(l);
    for (const e of mine) {
      takenRight.add(e.right);
      const rest = solve(nLeft, nRight, open(edges));
      if (rest.pairs + 1 === target.pairs && rest.cost + e.cost === target.cost) {
        chosen.push({ left: l, right: e.right });
        target = rest;
        break;
      }
      takenRight.delete(e.right);
    }
  }
  return chosen;
}
