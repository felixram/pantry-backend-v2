CREATE TABLE "tax_rate_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taxRateId" uuid,
	"taxRateName" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action" text NOT NULL,
	"userId" uuid NOT NULL,
	"reason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_rate_audit" ADD CONSTRAINT "tax_rate_audit_taxRateId_tax_rate_id_fk" FOREIGN KEY ("taxRateId") REFERENCES "public"."tax_rate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rate_audit" ADD CONSTRAINT "tax_rate_audit_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rate_audit" ADD CONSTRAINT "tax_rate_audit_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_rate_audit_taxRateId_index" ON "tax_rate_audit" USING btree ("taxRateId");--> statement-breakpoint
CREATE INDEX "tax_rate_audit_tenant_id_index" ON "tax_rate_audit" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tax_rate_audit_createdAt_index" ON "tax_rate_audit" USING btree ("createdAt");--> statement-breakpoint
ALTER TABLE "tax_rate" DROP COLUMN "is_default";