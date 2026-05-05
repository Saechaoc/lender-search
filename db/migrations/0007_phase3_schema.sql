CREATE TABLE "evaluation_event" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scenario_hash" text NOT NULL,
	"scenario_payload" jsonb NOT NULL,
	"ruleset_snapshot_id" text NOT NULL,
	"program_version_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"deciding_rule_id" uuid,
	"deciding_rule_layer" text,
	"rule_stack" jsonb NOT NULL,
	"near_miss_delta" jsonb,
	"evaluator_version" text NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_event_id_evaluated_at_pk" PRIMARY KEY("id","evaluated_at"),
	CONSTRAINT "evaluation_event_decision_check" CHECK ("evaluation_event"."decision" IN ('eligible','near_miss','ineligible'))
);
--> statement-breakpoint
ALTER TABLE "evaluation_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cascade_review_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_version_id" uuid NOT NULL,
	"prior_agency_rule_version_id" uuid NOT NULL,
	"new_agency_rule_version_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cascade_review_queue_status_check" CHECK ("cascade_review_queue"."status" IN ('pending','claimed','completed','dismissed'))
);
--> statement-breakpoint
ALTER TABLE "cascade_review_queue" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conforming_loan_limit_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"effective_period" daterange NOT NULL,
	"source_url" text NOT NULL,
	"source_pdf_sha256" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conforming_loan_limit_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conforming_loan_limit_county" (
	"limit_version_id" uuid NOT NULL,
	"county_fips" text NOT NULL,
	"state_code" char(2) NOT NULL,
	"one_unit_baseline" numeric NOT NULL,
	"two_unit_baseline" numeric,
	"three_unit_baseline" numeric,
	"four_unit_baseline" numeric,
	"one_unit_high_balance" numeric,
	"two_unit_high_balance" numeric,
	"three_unit_high_balance" numeric,
	"four_unit_high_balance" numeric,
	"is_high_cost" boolean DEFAULT false NOT NULL,
	CONSTRAINT "conforming_loan_limit_county_limit_version_id_county_fips_pk" PRIMARY KEY("limit_version_id","county_fips")
);
--> statement-breakpoint
ALTER TABLE "conforming_loan_limit_county" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program_version" ADD COLUMN "conforming_loan_limit_version_id" uuid;--> statement-breakpoint
ALTER TABLE "evaluation_event" ADD CONSTRAINT "evaluation_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_event" ADD CONSTRAINT "evaluation_event_program_version_id_program_version_id_fk" FOREIGN KEY ("program_version_id") REFERENCES "public"."program_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade_review_queue" ADD CONSTRAINT "cascade_review_queue_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade_review_queue" ADD CONSTRAINT "cascade_review_queue_program_version_id_program_version_id_fk" FOREIGN KEY ("program_version_id") REFERENCES "public"."program_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade_review_queue" ADD CONSTRAINT "cascade_review_queue_prior_agency_rule_version_id_agency_rule_version_id_fk" FOREIGN KEY ("prior_agency_rule_version_id") REFERENCES "public"."agency_rule_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade_review_queue" ADD CONSTRAINT "cascade_review_queue_new_agency_rule_version_id_agency_rule_version_id_fk" FOREIGN KEY ("new_agency_rule_version_id") REFERENCES "public"."agency_rule_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conforming_loan_limit_county" ADD CONSTRAINT "conforming_loan_limit_county_limit_version_id_conforming_loan_limit_version_id_fk" FOREIGN KEY ("limit_version_id") REFERENCES "public"."conforming_loan_limit_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evaluation_event_tenant_evaluated_idx" ON "evaluation_event" USING btree ("tenant_id","evaluated_at");--> statement-breakpoint
CREATE INDEX "cascade_review_queue_tenant_status_created_idx" ON "cascade_review_queue" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "cascade_review_queue_pending_idx" ON "cascade_review_queue" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "conforming_loan_limit_version_year_idx" ON "conforming_loan_limit_version" USING btree ("year");--> statement-breakpoint
ALTER TABLE "program_version" ADD CONSTRAINT "program_version_conforming_loan_limit_version_id_conforming_loan_limit_version_id_fk" FOREIGN KEY ("conforming_loan_limit_version_id") REFERENCES "public"."conforming_loan_limit_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "evaluation_event_tenant_isolation" ON "evaluation_event" AS PERMISSIVE FOR ALL TO public USING ("evaluation_event"."tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("evaluation_event"."tenant_id" = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "cascade_review_queue_tenant_isolation" ON "cascade_review_queue" AS PERMISSIVE FOR ALL TO public USING ("cascade_review_queue"."tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("cascade_review_queue"."tenant_id" = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "cascade_review_queue_system_write" ON "cascade_review_queue" AS PERMISSIVE FOR ALL TO "system_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "conforming_loan_limit_version_world_read" ON "conforming_loan_limit_version" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "conforming_loan_limit_version_system_write" ON "conforming_loan_limit_version" AS PERMISSIVE FOR ALL TO "system_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "conforming_loan_limit_county_world_read" ON "conforming_loan_limit_county" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "conforming_loan_limit_county_system_write" ON "conforming_loan_limit_county" AS PERMISSIVE FOR ALL TO "system_role" USING (true) WITH CHECK (true);