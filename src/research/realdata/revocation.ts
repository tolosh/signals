// SIG-61 stub (tests first).
export const POLL_INTERVAL_MINUTES = 5;
export const DETECT_WITHIN_MINUTES = 0;
export const PURGE_WITHIN_HOURS = 0;
export class MemoryRevocationState {}
export type PollReport = {
  detected: number;
  purged: number;
  pending: number;
  overdue: number;
  checked: number;
  poll_failed: boolean;
  detection_at_risk: boolean;
};
export async function pollRevocations(_d: unknown, _at: string): Promise<PollReport> {
  return {
    detected: 0,
    purged: 0,
    pending: 0,
    overdue: 0,
    checked: 0,
    poll_failed: false,
    detection_at_risk: false,
  };
}
export async function reportRevoked(
  _d: unknown,
  _r: string,
  _at: string,
): Promise<{ status: string }> {
  return { status: "" };
}
