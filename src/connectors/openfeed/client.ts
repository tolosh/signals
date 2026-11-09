// SIG-61 stub (tests first).
import type { Signer } from "./jose.js";
export type FetchResponse = {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};
export type Fetch = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponse>;
export class OpenfeedError extends Error {}
export class GrantRevokedError extends OpenfeedError {}
export class CreditExhaustedError extends OpenfeedError {}
export type UserTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: number;
  grantId: string;
};
export type ClientConfig = {
  clientId: string;
  redirectUri: string;
  issuer: string;
  apiBase: string;
  clientSigner: Signer;
  dpopSigner: Signer;
  fetch: Fetch;
  nowSeconds: () => number;
  newId: () => string;
  sleep: (ms: number) => Promise<void>;
};
export const pkceChallenge = (_v: string): string => "";
export class OpenfeedClient {
  constructor(readonly config: ClientConfig) {}
  async listGrants(): Promise<{ id: string; revision: number }[]> {
    return [];
  }
  async pushAuthorization(_o: {
    state: string;
    codeVerifier: string;
  }): Promise<{ requestUri: string; authorizeUrl: string }> {
    return { requestUri: "", authorizeUrl: "https://x.invalid/" };
  }
  async exchangeCode(_o: { code: string; codeVerifier: string }): Promise<UserTokens> {
    return { accessToken: "", refreshToken: "", tokenType: "", expiresAt: 0, grantId: "" };
  }
  async refresh(_rt: string): Promise<UserTokens> {
    return this.exchangeCode({ code: "", codeVerifier: "" });
  }
  async getGrant(
    _t: UserTokens,
    _id: string,
  ): Promise<{ grantStatus: string; bankingAccountIds: string[] }> {
    return { grantStatus: "", bankingAccountIds: [] };
  }
  async listAccounts(_t: UserTokens): Promise<{ accountId: string }[]> {
    return [];
  }
  async listTransactions(
    _t: UserTokens,
    _a: string,
    _w: { oldestDate: string; newestDate: string },
  ): Promise<{ accountId: string }[]> {
    return [];
  }
}
