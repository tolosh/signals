// SIG-61 stub (tests first).
export const CONNECT_TTL_MINUTES = 0;
export class MemoryPendingConnects {}
export const consumerRefFromInvite = (_i: string): string => "";
export async function startConnect(
  _d: unknown,
  _i: unknown,
): Promise<{ authorizeUrl: string; state: string }> {
  return { authorizeUrl: "https://x.invalid/?request_uri=x", state: "" };
}
export async function completeConnect(_d: unknown, _i: unknown): Promise<{ status: string }> {
  return { status: "" };
}
