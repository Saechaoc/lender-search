# Claude API Integration

Two direct browser → Anthropic API calls. Both use:
- Endpoint: `https://api.anthropic.com/v1/messages`
- Headers: `x-api-key` from `localStorage.ls_claude_api_key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`
- Model: `claude-haiku-4-5-20251001`

## 1. `parseScenario()` — App.js ~L1279
- Purpose: extract structured scenario fields from broker free-text.
- `max_tokens: 512`.
- System prompt is a strict-extraction instruction listing every scenario field. Critical rules: never infer, only extract explicit values, return `null` for unmentioned fields.
- Response: expects single JSON object in `data.content[0].text`. Regex `/\{[\s\S]*\}/` extracts. Maps each non-null value into `scenario` state and triggers `evaluateScenario` automatically.
- Errors stored in `parseError`.

## 2. `askQuestion(questionText, loanTypeFilter)` — App.js ~L1349
- Purpose: guideline Q&A grounded in loaded programs.
- `max_tokens: 1024`.
- System prompt = static instructions + "LOADED LENDER PROGRAM DATA:" + `formatProgramContext(allPrograms, loanTypeFilter)`.
  - When `loanTypeFilter==="All Types"`: summary view grouped by agency (uses `formatProgramSummary`).
  - Otherwise: full detail per matching program (uses `formatProgramDetailed`).
- User message: `"[Loan type filter: <filter>] Question: <text>"`.
- Response stored to `qaAnswer` and prepended into `qaHistory` (capped at 50 entries, persisted to `localStorage.ls_qa_history`).
- Errors stored in `qaError`.

## Considerations when modifying
- API key lives only in `localStorage` — Admin panel writes to it on every keystroke (no Save button).
- No retries, no streaming, no prompt caching. If adding caching, set cache breakpoints on the static portion of the system prompt + program context (use `cache_control: { type: "ephemeral" }` on content blocks and switch to structured `system` array form).
- If migrating models: only one place each (`parseScenario`, `askQuestion`). Always default to current most capable Claude model when building/extending here.
- Response parsing in `parseScenario` is fragile — relies on the model returning JSON within `{ ... }`. Consider tool use / structured output if errors become common.
