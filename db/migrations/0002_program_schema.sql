CREATE TYPE "public"."program_rule_layer" AS ENUM('INVESTOR_OVERLAY', 'PRODUCT_FEATURE');--> statement-breakpoint
CREATE TYPE "public"."rule_kind" AS ENUM('ltv_max', 'cltv_max', 'hcltv_max', 'fico_min', 'dti_max', 'reserves_min', 'derog_seasoning', 'income_doc_method', 'dscr_method', 'geo_state', 'geo_county', 'occupancy_allow', 'purpose_allow', 'property_type_allow', 'doc_type_allow', 'mi_required', 'manual_uw_path');--> statement-breakpoint
CREATE TABLE "rule_citation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_pdf_sha256" text,
	"source_url" text,
	"page_number" integer,
	"bbox" jsonb,
	"excerpt" text NOT NULL,
	"secondary_for_rule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rule_citation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lender" text NOT NULL,
	"channel" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "program" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"agency_rule_version_id" uuid NOT NULL,
	"effective_period" daterange NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text NOT NULL,
	"source_document_fingerprint" text NOT NULL,
	"eligible_loan_purposes" text[],
	"ineligible_loan_purposes" text[],
	"eligible_property_types" text[],
	"ineligible_property_types" text[],
	"eligible_occupancies" text[],
	"ineligible_occupancies" text[],
	"eligible_doc_types" text[],
	"ineligible_doc_types" text[],
	"eligible_states" text[],
	"ineligible_states" text[],
	"geo_county_overlay" jsonb
);
--> statement-breakpoint
ALTER TABLE "program_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_version_id" uuid NOT NULL,
	"layer" "program_rule_layer" NOT NULL,
	"rule_kind" "rule_kind" NOT NULL,
	"rule_body" jsonb NOT NULL,
	"field_confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"primary_citation_id" uuid NOT NULL,
	"extraction_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "program_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agency_rule_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency" text NOT NULL,
	"version_label" text NOT NULL,
	"source_url" text,
	"source_pdf_sha256" text,
	"effective_period" daterange NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_by" uuid
);
--> statement-breakpoint
ALTER TABLE "agency_rule_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agency_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_rule_version_id" uuid NOT NULL,
	"rule_kind" "rule_kind" NOT NULL,
	"rule_body" jsonb NOT NULL,
	"field_confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"primary_citation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agency_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lender_overlay_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"applies_to_program_id" uuid,
	"rule_kind" "rule_kind" NOT NULL,
	"rule_body" jsonb NOT NULL,
	"field_confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"primary_citation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lender_overlay_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rule_citation" ADD CONSTRAINT "rule_citation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_version" ADD CONSTRAINT "program_version_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_version" ADD CONSTRAINT "program_version_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_version" ADD CONSTRAINT "program_version_agency_rule_version_id_agency_rule_version_id_fk" FOREIGN KEY ("agency_rule_version_id") REFERENCES "public"."agency_rule_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_rule" ADD CONSTRAINT "program_rule_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_rule" ADD CONSTRAINT "program_rule_program_version_id_program_version_id_fk" FOREIGN KEY ("program_version_id") REFERENCES "public"."program_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_rule" ADD CONSTRAINT "program_rule_primary_citation_id_rule_citation_id_fk" FOREIGN KEY ("primary_citation_id") REFERENCES "public"."rule_citation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_rule_version" ADD CONSTRAINT "agency_rule_version_superseded_by_agency_rule_version_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."agency_rule_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_rule" ADD CONSTRAINT "agency_rule_agency_rule_version_id_agency_rule_version_id_fk" FOREIGN KEY ("agency_rule_version_id") REFERENCES "public"."agency_rule_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_rule" ADD CONSTRAINT "agency_rule_primary_citation_id_rule_citation_id_fk" FOREIGN KEY ("primary_citation_id") REFERENCES "public"."rule_citation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lender_overlay_rule" ADD CONSTRAINT "lender_overlay_rule_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lender_overlay_rule" ADD CONSTRAINT "lender_overlay_rule_applies_to_program_id_program_id_fk" FOREIGN KEY ("applies_to_program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lender_overlay_rule" ADD CONSTRAINT "lender_overlay_rule_primary_citation_id_rule_citation_id_fk" FOREIGN KEY ("primary_citation_id") REFERENCES "public"."rule_citation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rule_citation_tenant_idx" ON "rule_citation" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "program_tenant_idx" ON "program" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "program_version_tenant_idx" ON "program_version" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "program_version_agency_rule_version_idx" ON "program_version" USING btree ("agency_rule_version_id");--> statement-breakpoint
CREATE INDEX "program_rule_tenant_idx" ON "program_rule" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "program_rule_version_layer_kind_idx" ON "program_rule" USING btree ("program_version_id","layer","rule_kind");--> statement-breakpoint
CREATE INDEX "agency_rule_version_agency_idx" ON "agency_rule_version" USING btree ("agency");--> statement-breakpoint
CREATE INDEX "agency_rule_version_kind_idx" ON "agency_rule" USING btree ("agency_rule_version_id","rule_kind");--> statement-breakpoint
CREATE INDEX "lender_overlay_rule_tenant_idx" ON "lender_overlay_rule" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "rule_citation_tenant_isolation" ON "rule_citation" AS PERMISSIVE FOR ALL TO public USING ("rule_citation"."tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("rule_citation"."tenant_id" = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "program_tenant_isolation" ON "program" AS PERMISSIVE FOR ALL TO public USING ("program"."tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("program"."tenant_id" = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "program_version_tenant_isolation" ON "program_version" AS PERMISSIVE FOR ALL TO public USING ("program_version"."tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("program_version"."tenant_id" = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "program_rule_tenant_isolation" ON "program_rule" AS PERMISSIVE FOR ALL TO public USING ("program_rule"."tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("program_rule"."tenant_id" = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "agency_rule_version_world_read" ON "agency_rule_version" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "agency_rule_version_system_write" ON "agency_rule_version" AS PERMISSIVE FOR ALL TO "system_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "agency_rule_world_read" ON "agency_rule" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "agency_rule_system_write" ON "agency_rule" AS PERMISSIVE FOR ALL TO "system_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "lender_overlay_rule_tenant_isolation" ON "lender_overlay_rule" AS PERMISSIVE FOR ALL TO public USING ("lender_overlay_rule"."tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("lender_overlay_rule"."tenant_id" = current_setting('app.tenant_id', true)::uuid);