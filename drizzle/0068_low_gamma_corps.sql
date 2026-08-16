CREATE TABLE "location_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"locationId" uuid,
	"locationName" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action" text NOT NULL,
	"userId" uuid NOT NULL,
	"reason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "location_audit" ADD CONSTRAINT "location_audit_locationId_location_id_fk" FOREIGN KEY ("locationId") REFERENCES "public"."location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_audit" ADD CONSTRAINT "location_audit_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_audit" ADD CONSTRAINT "location_audit_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_audit_locationId_index" ON "location_audit" USING btree ("locationId");--> statement-breakpoint
CREATE INDEX "location_audit_tenant_id_index" ON "location_audit" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "location_audit_createdAt_index" ON "location_audit" USING btree ("createdAt");