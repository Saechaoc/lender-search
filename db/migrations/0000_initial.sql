CREATE TYPE "public"."tenant_kind" AS ENUM('BROKERAGE', 'RETAIL_LENDER', 'WHOLESALE_LENDER', 'SYSTEM');--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "tenant_kind" NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "_rls_canary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payload" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "_rls_canary" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "_rls_canary" ADD CONSTRAINT "_rls_canary_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rls_canary_tenant_idx" ON "_rls_canary" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "tenant_self_filter" ON "tenant" AS PERMISSIVE FOR ALL TO public USING ("tenant"."id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant"."id" = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "canary_tenant_isolation" ON "_rls_canary" AS PERMISSIVE FOR ALL TO public USING ("_rls_canary"."tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("_rls_canary"."tenant_id" = current_setting('app.tenant_id', true)::uuid);