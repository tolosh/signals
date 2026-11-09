// Stub, before the change (SIG-42 rulings of 10 November 2026): the first-word rule alone.
export const LENDER_NAMES_VERSION = "0.0.0";
export const LENDER_NAMES: readonly string[] = [];
export const lenderOf = (provider: string) => provider.split(" ")[0] ?? provider;
