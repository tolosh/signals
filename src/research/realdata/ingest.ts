// SIG-61 stub (tests first).
export const LOOKBACK_MONTHS = 0;
export const TRANSACTION_FIELDS: readonly string[] = [];
export async function ingestGrant(
  _d: unknown,
  _i: unknown,
): Promise<{ status: string; accounts: number; transactions: number; purge?: { status: string } }> {
  return { status: "", accounts: 0, transactions: 0 };
}
