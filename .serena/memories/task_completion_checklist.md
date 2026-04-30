# Task Completion Checklist

When completing a coding task on lender-search:

1. **Pre-edit (per CLAUDE.md)**
   - Run GitNexus impact analysis on any function/symbol you'll modify: `gitnexus_impact({target:"<symbolName>",direction:"upstream"})`. Warn user on HIGH/CRITICAL.
   - Don't rename via find-and-replace — use `gitnexus_rename`.

2. **Verify build still compiles**
   - `npm start` (or at minimum `npm run build`) — the dev server fails fast on syntax errors. CRA does the bundling; there is no separate `tsc`/`eslint` step the user runs.
   - Browser test: open localhost:3000, exercise the changed view (search / qa / admin).

3. **Functional verification for evaluator changes**
   - Changes to `evaluateScenario` must be hand-tested against representative scenarios. Pick at least one matched and one failing program, verify pass/fail/warning lists make sense.

4. **Run the smoke test**
   - `npm test -- --watchAll=false` — only the default CRA smoke test exists, but it must still pass after edits.

5. **Pre-commit**
   - `gitnexus_detect_changes()` per CLAUDE.md.

6. **No backend / no migrations** — purely client-side; nothing to deploy beyond a static build. Don't write infrastructure code unless explicitly asked.

7. **Don't reformat untouched data** — SEED_PROGRAMS literals are intentionally dense. Only edit the specific entry being changed.

8. **Don't add documentation files** unless user asks — README.md is CRA boilerplate by design.
