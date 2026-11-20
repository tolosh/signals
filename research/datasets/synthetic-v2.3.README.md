# Synthetic set v2.3 (SIG-63)

The working synthetic set from 20 November 2026 (ruling, SIG-63 comment 40483), under the caveats
below. Set v2.2 stays as run. Decision record: `docs/adr/0010-synthetic-set-v2.3.md`.

- **Generator** 2.3.0, `src/research/generator/v23/`, frozen after `4fbddf6`. Ground truth schema
  2.3.0 (`research/schemas/ground-truth-v2.3.schema.json`).
- **Seed** 623; 780 applicants; 142,283 transactions; set hash
  `69dcc096db8f0b11ea14848ad5e037e6b3d8bdc52a97a6cfe74613bd946898ba`
  (`synthetic-v2.3.manifest.json`).
- **Regenerate and check:** `npx tsx scripts/generate-synthetic-v2.ts --variant 2.3 --check`. The
  applicant files are not committed.
- **Pre-registration** `research/preregistrations/SIG-63.json` (with amendments A1 to A5) and
  `SIG-63-r2.json`. Reserved unseen-lender names are invented and checked against the ASIC credit
  registers: `synthetic-v2.3.reserved-names-asic.json`.

## T7: FAILED, as run

`research/runs/2026-11-19-sig63r2-leakage-v2.3.json`: 8 labels in the record, 10 under the ruling
that a family-level flag fails a label (comment 40470). Independent review 13 (comment 40477)
classed most failures as test-design issues: T7's false-alarm rate breaks for labels clustered by
biller or applicant. That is fixed in SIG-65, not in this set. Validity checks V1 to V11 pass.

## Fitness (review 13): preferred for every use; ties with v2.2 for SIG-46

Caveats for every use:

- no cross-applicant code statistics;
- cluster by lender or issuer for the unseen-lender and no-card-cue groups;
- drift is scored per applicant;
- salaried pay is identical to the cent;
- no sensitive merchants, so GR-3 can't be tested on this set;
- dishonour scoring is **NOT FIT** for prediction from balances;
- any SIG-57 re-run is a new pre-registration that discloses that v2.3 was designed after SIG-57's
  v2.2 result.

Minor artefacts, for any future set: too few bill billers (28); lenders always use their legal
biller name; dining placement depends on whether the card is shared; dishonours unrelated to
balance.

## Notes on how it was made (review 13, O and V)

1. SIG-57's pre-registration (`73c7301`) is on a separate branch: its precedence over the v2.3 work
   rests on commit times.
2. SIG-57 had run and been refuted on v2.2 before v2.3 was designed, by the same author, so the
   declaration generator was built knowing SIG-57's failure modes.
3. V9 was tuned before the run and disclosed (strict pairs 183, 187, 194, 203; amendment A5).

**V9's margin is narrow:** 203 distinct pairs and at most 3 repeats pass the registered rule (at
least 200, at most 4), but a slightly stricter count gives 184 pairs and 5 repeats, which would
fail.
