# Deferred items — quick task 260506-al0

Two followups carried forward from the rule_snapshot per-tenant scope migration (Option B / 0022).

## 1. Phase 4 evaluator migration: re-add composite FK + connect as app_user

Migration 0022 dropped `evaluation_event_ruleset_snapshot_fkey` (the single-column FK from `evaluation_event.ruleset_snapshot_id` to `rule_snapshot.sha256_hash`) because `rule_snapshot.sha256_hash` is no longer unique standalone — the new UNIQUE is `(tenant_id, sha256_hash)`.

Phase 4's first migration MUST:

1. Re-add the FK as composite:
   ```sql
   ALTER TABLE evaluation_event
     ADD CONSTRAINT evaluation_event_ruleset_snapshot_fkey
     FOREIGN KEY (tenant_id, ruleset_snapshot_id)
     REFERENCES rule_snapshot (tenant_id, sha256_hash)
     DEFERRABLE INITIALLY DEFERRED;
   ```
   (DEFERRABLE so persistSnapshot + INSERT evaluation_event still execute in a single transaction with snapshot-first ordering; same posture as 0015 had.)

2. Connect the evaluator as `app_user` with `app.tenant_id` set via `set_config`. Do NOT use the `system_role` role-transition path implied by 0019's header comment — the tenant_isolation policy is the wall, not a role switch. The rest of the request runs as app_user under the standard tenant GUC; the snapshot read happens in the same role context.

This deferral is documented in the header of `db/migrations/0022_rule_snapshot_tenant_scope.sql`.

## 2. Long-term seed pool refactor (still open)

Migration 0022 deleted the seed-time snapshot write (Option B made "baseline-system snapshot with no tenant" incoherent), so the immediate concern collapses for the rule_snapshot surface specifically. But the broader seed posture remains: `scripts/seed-agency.ts` connects via `DATABASE_MIGRATION_URL` (postgres superuser), which bypasses RLS even after 0022.

The longer-term fix is a tenant-scoped non-superuser pool for any seed step that touches tenant-scoped tables (program_version, lender_overlay_rule, etc.). Per-tenant seed runs would set `app.tenant_id` on the connection like the runtime path does, so the seed honors RLS the same way the application does.

Tag: "rework seed to use a tenant-scoped non-superuser pool — defer until a reason that isn't this bug surfaces."

This is a posture / architecture follow-up, not a security fix. The current seed only writes to system-owned tables (agency_rule_version, agency_rule, conforming_loan_limit_*) and the (deleted) snapshot, which is why bypass-RLS via the superuser pool was tolerable. Any future seed step that wants to write tenant-scoped rows MUST trigger this refactor before landing.
