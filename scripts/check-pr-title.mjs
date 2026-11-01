// SIG-9: every PR title starts with its Jira key, e.g. "SIG-9: Repository setup".
import { fileURLToPath } from "node:url";

export function hasSigKey(title) {
  return /^SIG-\d+: \S/.test(title);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const title = process.env.PR_TITLE ?? "";
  if (!hasSigKey(title)) {
    console.error(`PR title must start "SIG-<n>: <summary>". Got: ${JSON.stringify(title)}`);
    process.exit(1);
  }
}
