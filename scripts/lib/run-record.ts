// SIG-56: shared helpers for research run scripts, so every run is reproducible from its record
// alone (H0). A script parses its arguments with parseRunArgs, calls requireCleanTree before it
// runs, puts provenance() in its record, and writes with writeNew, which never overwrites.
// Seeds come from the manifest (manifestSeed), never from the script.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_OUT = "research/runs";
export const DEFAULT_MANIFEST = "research/datasets/synthetic-v1.manifest.json";

export type RunArgs = {
  /** The arguments as given, flags without a value as "true". */
  values: Record<string, string>;
  /** The folder records are written to (--out), research/runs by default. */
  out: string;
  allowDirty: boolean;
  argv: string[];
};

export function parseRunArgs(
  argv: string[] = process.argv.slice(2),
  defaultOut: string = DEFAULT_OUT,
): RunArgs {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) values[a.slice(2)] = "true";
    else {
      values[a.slice(2)] = next;
      i++;
    }
  }
  const { out = defaultOut, "allow-dirty": dirty, ...rest } = values;
  return { values: rest, out, allowDirty: dirty === "true", argv };
}

export const arg = (args: RunArgs, name: string, fallback: string): string =>
  args.values[name] ?? fallback;

export type GitState = { commit: string; status: string };
export function gitState(): GitState {
  const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();
  return { commit: git("rev-parse", "HEAD"), status: git("status", "--porcelain") };
}

/** Refuses to run on uncommitted changes, so engine.commit is the code that ran. */
export function requireCleanTree(status: string, allowDirty: boolean): void {
  if (status.trim() && !allowDirty)
    throw new Error(
      `Uncommitted changes; commit them, or pass --allow-dirty (recorded):\n${status.trim()}`,
    );
}

export type Provenance = {
  command: string;
  arguments: Record<string, string>;
  engine_commit: string;
  tree: "clean" | "dirty (--allow-dirty)";
};
export function provenance(script: string, args: RunArgs, git: GitState): Provenance {
  return {
    command: ["npx tsx", script, ...args.argv].join(" "),
    arguments: args.values,
    engine_commit: git.commit,
    tree: git.status.trim() ? "dirty (--allow-dirty)" : "clean",
  };
}

/** Writes a new file, creating its folder. An existing file is never overwritten. */
export function writeNew(path: string, content: string): void {
  if (existsSync(path))
    throw new Error(`${path} exists; records are never overwritten. Use --out for a re-run.`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export type Manifest = {
  set: string;
  seed: number;
  set_sha256: string;
  generator_version?: string;
  ground_truth_schema_version?: string;
};
export function manifestSeed(path = DEFAULT_MANIFEST): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}
