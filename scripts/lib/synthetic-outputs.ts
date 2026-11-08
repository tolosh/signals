// SIG-60 (the set v2.1 review's G4): the synthetic-set scripts decide their outputs before they
// generate anything. An existing folder or manifest stops the run at once, naming the path, so a
// run never writes hundreds of files and then fails on the manifest. `--check` regenerates in
// memory and compares with the committed manifest, writing nothing.
import { existsSync, readFileSync } from "node:fs";

export function planOutputs(out: string): { folder: string; manifest: string } {
  const manifest = `${out}.manifest.json`;
  // The manifest first: it is the committed file a run would collide with.
  for (const p of [manifest, out])
    if (existsSync(p))
      throw new Error(
        `${p} exists; nothing is overwritten. Use --check to compare a regeneration with the ` +
          `committed manifest, or --out a new path.`,
      );
  return { folder: out, manifest };
}

export type GeneratedFile = { id: string; sha256: string };
/** Compares a regeneration with a committed manifest; returns the differences (none: it matches). */
export function checkAgainstManifest(
  path: string,
  seed: number,
  setSha256: string,
  files: GeneratedFile[],
): string[] {
  if (!existsSync(path)) return [`${path} is not committed`];
  const m = JSON.parse(readFileSync(path, "utf8")) as {
    seed: number;
    set_sha256: string;
    files: GeneratedFile[];
  };
  const diffs: string[] = [];
  if (m.seed !== seed) diffs.push(`seed ${seed}, manifest ${m.seed}`);
  if (m.set_sha256 !== setSha256) diffs.push(`set hash ${setSha256}, manifest ${m.set_sha256}`);
  if (m.files.length !== files.length)
    diffs.push(`${files.length} applicants, manifest ${m.files.length}`);
  files.forEach((f, i) => {
    const want = m.files[i];
    if (!want || want.id !== f.id || want.sha256 !== f.sha256)
      if (diffs.length < 10) diffs.push(`applicant ${i}: ${f.id} differs`);
  });
  return diffs;
}
