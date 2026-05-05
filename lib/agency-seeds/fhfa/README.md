# FHFA Conforming Loan Limits — Annual Seed CSV

This directory holds the **FHFA FINAL FLAT** conforming loan limit CSV
that `scripts/seed-agency.ts::seedFhfaYear` ingests into
`conforming_loan_limit_version` + `conforming_loan_limit_county` at
`pnpm db:seed` time.

Per CONTEXT D-23 the file is a **manually-downloaded annual artifact** because
the FHFA publication URL is non-versioned (the same URL serves whatever year
is current). Plan 03-06 Task 01 is `checkpoint:human-action` to capture the
download + checksum at commit time so subsequent cycles re-use the committed
copy without re-downloading.

## 2026 file

| Field        | Value                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Filename     | `2026-conforming-limit-values-by-county.csv`                                                                         |
| Source URL   | `https://www.fhfa.gov/data/conforming-loan-limit` (non-versioned; navigate to the 2026 row and download the FINAL FLAT CSV) |
| Variant      | **FINAL FLAT** (per Open Question 8 — FINAL FLAT is what wholesale lenders use; HERA-BASED is informational)         |
| SHA256       | `3e4aa578ce0db02db241e2721362e978b097fad70e1532324e0d30a798dd67a8`                                                    |
| Row count    | 3,235 county rows (header on lines 1–2; data on lines 3–3,237)                                                       |
| Format quirks| (a) header is wrapped across two physical lines inside quoted cells, so csv-parse emits column keys with embedded `\n` (e.g. `"One-Unit\nLimit"`); (b) limit values are formatted strings like `"$832,750 "` — `$` + thousand-separator commas + trailing whitespace; (c) FIPS state codes are 1–2 digits, FIPS county codes are 1–3 digits, both zero-padded by the loader's Zod schema |
| BOM          | The csv-parse `bom: true` option strips any UTF-8 BOM if present                                                     |

Verify integrity:

```bash
shasum -a 256 lib/agency-seeds/fhfa/2026-conforming-limit-values-by-county.csv
# Must output: 3e4aa578ce0db02db241e2721362e978b097fad70e1532324e0d30a798dd67a8
wc -l lib/agency-seeds/fhfa/2026-conforming-limit-values-by-county.csv
# Must output ~3240 (1 wrapped-header pair + 3,235 data rows + EOF)
head -3 lib/agency-seeds/fhfa/2026-conforming-limit-values-by-county.csv
# First non-header row must start `01,001,AUTAUGA COUNTY,AL,…` — leading zeros preserved
```

If the leading zero on Alabama's state code (`01`) was stripped to `1`, the
CSV was saved through Excel without preserving FIPS column text formatting.
Re-export from the source XLSX selecting "Text" formatting on the FIPS columns,
or download the FHFA-published CSV variant directly if available.

## High-cost derivation rule (Open Question 7 / Assumption A5)

`is_high_cost` is **stored at load time**, not derived at read time:

```
is_high_cost = (one_unit_baseline > FHFA_2026_ONE_UNIT_BASELINE)
             = (one_unit_baseline > 832750)
```

The 2026 baseline of $832,750 lives as the `FHFA_2026_ONE_UNIT_BASELINE`
constant in `scripts/seed-agency.ts`. When FHFA publishes the 2027 table,
extend the constant set (e.g. `FHFA_2027_ONE_UNIT_BASELINE`) and switch
`seedFhfaYear` to look it up by year. The seeded `is_high_cost` flag must
match the year-specific baseline, not the prior year's, so storing the
derived value at load time avoids cross-year drift.

## Annual update procedure (D-23)

When FHFA publishes the next year's limits (typically late November of the
prior year):

1. **Download.** Visit `https://www.fhfa.gov/data/conforming-loan-limit`,
   pick the new year's row, download the FINAL FLAT CSV (or XLSX → CSV
   exporting with Text format on the FIPS columns).
2. **Save.** As `lib/agency-seeds/fhfa/{YEAR}-conforming-limit-values-by-county.csv`.
3. **Verify integrity.** Run the three commands in the "Verify integrity"
   block above. The first data row should preserve FIPS leading zeros.
4. **Update this README** with the new file's filename, SHA256, and row count
   in a new heading like `## {YEAR} file`. Keep older years' entries for the
   audit trail.
5. **Add the year baseline constant.** In `scripts/seed-agency.ts`, add
   `FHFA_{YEAR}_ONE_UNIT_BASELINE = …` with the published baseline limit and
   extend `seedFhfaYear` to look it up by `year`. (Currently the function
   raises if `year !== 2026`.)
6. **Wire the call.** In `scripts/seed/index.ts`, add
   `await seedFhfaYear({YEAR}, csvPath);` after the existing 2026 call. The
   loader's two-step daterange close (REVIEWS.md B10 — uses
   `upper_inf(effective_period)`) automatically closes the prior year's
   open-ended `[YYYY-01-01,)` range to `[YYYY-01-01,{YEAR}-01-01)` so the
   `EXCLUDE` constraint allows the new year's range without overlap.
7. **Run + test.** Run `pnpm db:reset && pnpm drizzle-kit migrate && pnpm
   db:seed && pnpm test:schema -t 'FHFA'`. The structural tests at
   `tests/schema/fhfa-loan-limits.test.ts` cover row counts, FIPS leading
   zero preservation, `is_high_cost` derivation, and the
   `upper_inf(effective_period)` open-ended-version detection convention.
   Add a per-year spot-check assertion if the new year's published table
   changes any of LA County / Autauga / Honolulu (the existing fixtures).

The loader is **idempotent** for a given year: re-running `pnpm db:seed`
without resetting the DB reuses the existing `conforming_loan_limit_version`
row by year and skips county INSERTs via `ON CONFLICT
(limit_version_id, county_fips) DO NOTHING`.

## Why "FINAL FLAT" not "HERA-BASED"?

Per Open Question 8: FHFA publishes two variants of the limit table:

- **FINAL FLAT** — the actual conforming limit. Higher in high-cost areas
  (the "high-balance" overlay). What wholesale lenders use; what borrowers
  see in their disclosures; what `program_version` rows reference.
- **HERA-BASED** — the formula output before the FINAL FLAT high-cost
  override. Informational only.

Lender Search uses FINAL FLAT exclusively. If this distinction ever matters
to a downstream feature (Phase 2+ pricing? Phase 6 cascade?), introduce a
new column rather than swapping the existing one.

## Daterange convention (REVIEWS.md B10)

Inserted version rows use the canonical PostgreSQL **truly-unbounded** form
`[{YEAR}-01-01,)`, NOT `[{YEAR}-01-01,infinity)`. The two are
**semantically distinct** in PostgreSQL:

- `'[YYYY-01-01,)'::daterange` → upper is unbounded; `upper_inf(…)` returns
  `true`. Canonical text form is `[YYYY-01-01,)`.
- `'[YYYY-01-01,infinity)'::daterange` → upper is bounded by the date type's
  `+infinity` sentinel; `upper_inf(…)` returns `false`. Canonical text form
  is `[YYYY-01-01,infinity)`.

The whole point of B10 is to use `upper_inf` as the canonical
"is-this-the-currently-open-version" detection mechanism instead of a
fragile text comparison. That requires the unbounded form. Wave 0/1 agency
seeds (FNMA / FHLMC / FHA / VA) keep the legacy `infinity` form because
their daterange-close detection happens to use text comparison; FHFA is
where B10 actually lands. If you find yourself wanting `upper_inf` semantics
on a non-FHFA agency table, migrate that table to the unbounded form too —
do not mix the two within a single table.
