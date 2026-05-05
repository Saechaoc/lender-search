<!-- generated-by: gsd-doc-writer -->
# Getting Started

This guide walks a new contributor from a fresh clone to a passing local test
suite. Phase 1 (Tenant Isolation Foundation) is local-only — there is no
Vercel deploy, Supabase project, or hosted environment to set up yet. The full
day-to-day workflow lives in [DEVELOPMENT.md](./DEVELOPMENT.md); the env-var
reference is in [CONFIGURATION.md](./CONFIGURATION.md); the system shape is
described in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Prerequisites

You must have the following installed before cloning:

| Tool        | Version            | Why it is required                                                |
| ----------- | ------------------ | ----------------------------------------------------------------- |
| Node.js     | `>= 20.9.0`        | Pinned in `package.json` `engines.node`                           |
| pnpm        | `>= 9.0.0`         | Pinned in `package.json` `engines.pnpm`; npm and yarn are not supported |
| Docker      | Any recent release | `pnpm db:up` runs the Postgres 16 service from `docker-compose.yml` |
| Git         | Any recent release | Required to clone the repository                                  |

The repository's package manager is pinned to `pnpm@9.15.0` via the
`packageManager` field in `package.json`. If you have Corepack enabled
(Node 20 ships with it), running any `pnpm` command in this directory will
auto-install the pinned version.

## Installation Steps

```bash
# 1. Clone the repository
git clone <repository-url> lender-search
cd lender-search

# 2. Install dependencies (pnpm only — npm and yarn will fail the engines check)
pnpm install

# 3. Bring up the local Postgres 16 container
#    docker-compose.yml provisions a postgres:16-alpine service on port 5432.
#    On first boot, scripts/init-db.sh provisions:
#      - app_user (NOBYPASSRLS, NOSUPERUSER) — used by the runtime app and pen tests
#      - system_role (NOLOGIN, NOBYPASSRLS, NOSUPERUSER) — used by agency-table writes
pnpm db:up

# 4. Copy the environment template and edit if needed
#    The defaults match the docker-compose.yml credentials and work out of the box.
cp .env.local.example .env.local

# 5. Apply Drizzle migrations (db/migrations/0000 → 0006) to the fresh database
pnpm db:migrate
```

After step 5 you have a working Postgres database with the Phase 1+ schema
applied — `tenant`, `_rls_canary`, `program_*`, `agency_*`, citation tables —
all with `FORCE ROW LEVEL SECURITY` enabled. See
[CONFIGURATION.md](./CONFIGURATION.md) for the full env-var reference and
[ARCHITECTURE.md](./ARCHITECTURE.md) for what those tables represent.

## First Run

The Phase 1 acceptance signal is the RLS pen-test suite passing locally:

```bash
pnpm test:rls
```

This runs the Vitest pen-test harness at `tests/rls/` against your local
Postgres. A passing run means your environment is correctly configured and
tenant isolation is enforced at the database level. There is no dev server,
CLI, or web UI to launch at Phase 1 — the `app/` directory is intentionally
empty until Phase 6 wires the Next.js App Router.

If you want to run all the same gates that CI runs before pushing a PR:

```bash
pnpm typecheck && pnpm lint && pnpm lint:fixture && pnpm test:rls
```

See [DEVELOPMENT.md](./DEVELOPMENT.md) for the full daily-workflow command
reference.

## Common Setup Issues

### `pnpm install` fails with an `engines` error

You are on Node < 20.9.0 or pnpm < 9.0.0. Upgrade Node (use `nvm install 20`
or your equivalent), then run `corepack enable` so the pinned `pnpm@9.15.0`
auto-activates in this directory.

### `pnpm db:up` fails with port 5432 already in use

A local Postgres install or another container is already bound to 5432. Stop
it (`brew services stop postgresql` or `docker ps` + `docker stop <id>`)
before running `pnpm db:up` again. The compose file does not expose an
alternate port.

### `pnpm db:migrate` fails with `permission denied` or RLS errors

The migration role is `postgres` (the superuser, defined via
`DATABASE_MIGRATION_URL` in `.env.local.example`). Only the table owner can
run `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, which is why this is
separate from `DATABASE_URL` (the runtime `app_user` connection). If
`DATABASE_MIGRATION_URL` is missing in `.env.local`, drizzle-kit falls back
to `DATABASE_URL` — which uses `app_user`, which cannot apply the FORCE-RLS
migrations. Confirm both URLs are present in `.env.local`.

### `pnpm test:rls` aborts with a "privileged connection" error

The pen-test setup file rejects connections that bypass RLS. This means
`DATABASE_URL` in `.env.local` is pointing at the `postgres` superuser
instead of `app_user`. Verify `DATABASE_URL` matches the value in
`.env.local.example` (it should start with `postgresql://app_user:...`).
Pen tests must connect as `app_user` so that `FORCE ROW LEVEL SECURITY` is
meaningful — superusers silently bypass RLS and would make the suite
vacuous.

### Database state seems corrupt or migrations are out of sync

Reset the local volume and re-run migrations from scratch:

```bash
pnpm db:reset    # drops the docker volume and re-runs init-db.sh
pnpm db:migrate  # re-applies db/migrations/0000 → 0006
```

This is safe — the local database holds no production data.

## Next Steps

You now have a working local environment. From here:

- [DEVELOPMENT.md](./DEVELOPMENT.md) — daily workflow, build commands, code
  style, lint and typecheck gates, branch and PR conventions
- [CONFIGURATION.md](./CONFIGURATION.md) — full environment-variable
  reference, including `DATABASE_URL` vs. `DATABASE_MIGRATION_URL`
- [ARCHITECTURE.md](./ARCHITECTURE.md) — the Postgres-centric system shape,
  RLS strategy, evaluation engine, and extraction pipeline
- [`.planning/STATE.md`](../.planning/STATE.md) — current phase status and
  what work has shipped
- [CLAUDE.md](../CLAUDE.md) — agent guidance, conventions, and the GSD
  workflow entry points (`/gsd-quick`, `/gsd-debug`, `/gsd-execute-phase`)
