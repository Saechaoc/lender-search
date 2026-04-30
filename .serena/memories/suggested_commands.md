# Suggested Commands

## Development
- `npm start` — dev server at http://localhost:3000
- `npm test` — Jest watch mode (CRA)
- `npm run build` — production build to `build/`
- `npm run eject` — one-way CRA eject (avoid)

## Project tooling
- `npx gitnexus analyze` — refresh GitNexus code index when stale (per CLAUDE.md)
- GSD (`.planning/`) — phase/milestone workflow available via `/gsd-*` slash commands

## System (macOS / Darwin)
- `git`, `ls`, `find`, `grep`, `rg` (ripgrep) — standard
- `wc -l <file>` — count lines (App.js is ~1775 lines)
- Read App.js with `Read` tool offset/limit (file too large to read at once)

## Search inside App.js
- Prefer Serena symbolic tools (`find_symbol`, `get_symbols_overview`, `search_for_pattern`) over full reads.
- For program-data lookups: `search_for_pattern` with the program `id` (e.g. `"pm-fnma-conforming"`).
