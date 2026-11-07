// SIG-51 (ADR 0005, ruled 7 November 2026): every stateful part of the mock registers a slice
// here. A slice can reset itself to the seeded fixtures, snapshot what it holds as JSON items keyed
// by ID, and restore those items. persist.ts uses that to keep the state in DynamoDB. Mock only:
// nothing in src/engines or the production API may import this.

export type Items = Record<string, unknown>;
export type Slice = {
  /** The resource type, used in the table's sort key: `${type}#${id}`. */
  type: string;
  reset(): void;
  snapshot(): Items;
  restore(items: Items): void;
};

const slices: Slice[] = [];

export function registerSlice(slice: Slice): void {
  if (slices.some((s) => s.type === slice.type)) throw new Error(`Slice ${slice.type} twice`);
  if (!/^[a-z_]+$/.test(slice.type)) throw new Error(`Bad slice type ${slice.type}`);
  slices.push(slice);
}

/** Every slice back to its seeded fixtures (a cold container, or the reset route). */
export function resetAllState(): void {
  for (const s of slices) s.reset();
}

/** Every slice's items, keyed `${type}#${id}`, each value as canonical JSON. */
export function snapshotAll(): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of slices)
    for (const [id, value] of Object.entries(s.snapshot()))
      out.set(`${s.type}#${id}`, JSON.stringify(value));
  return out;
}

/** Reset every slice, then apply the stored items. Items of an unknown type are ignored. */
export function restoreAll(items: Map<string, string>): void {
  resetAllState();
  for (const s of slices) {
    const mine: Items = {};
    const prefix = `${s.type}#`;
    for (const [key, value] of items)
      if (key.startsWith(prefix)) mine[key.slice(prefix.length)] = JSON.parse(value) as unknown;
    if (Object.keys(mine).length > 0) s.restore(mine);
  }
}

export const sliceTypes = () => slices.map((s) => s.type);
