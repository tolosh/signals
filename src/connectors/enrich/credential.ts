// SIG-70 T7: ApiEnrich calls Enrich under the lender's own tenant with Signals' service credential
// (D42; SIG-72), never with the lender's own Enrich key. A service credential is scoped to one
// named tenant. The secret itself is held in Secrets Manager; only its reference is passed here.

export type Credential = {
  kind: "signals_service" | "lender_key";
  tenant_id: string;
  /** A Secrets Manager reference, never the secret. */
  secret_ref: string;
};
export type ServiceCredential = Credential & { kind: "signals_service" };

/** The one service credential scoped to this tenant. */
export function credentialFor(
  tenantId: string,
  credentials: readonly Credential[],
): ServiceCredential {
  const forTenant = credentials.filter((c) => c.tenant_id === tenantId);
  if (forTenant.some((c) => c.kind === "lender_key"))
    throw new Error("the lender's own Enrich key is never used (D42)");
  const service = forTenant.filter((c): c is ServiceCredential => c.kind === "signals_service");
  if (service.length === 0) throw new Error(`no service credential for tenant ${tenantId}`);
  if (service.length > 1)
    throw new Error(`more than one service credential for tenant ${tenantId}`);
  return service[0] as ServiceCredential;
}
