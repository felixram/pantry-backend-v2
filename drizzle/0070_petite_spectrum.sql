CREATE TABLE "usage_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"eventType" text NOT NULL,
	"quantity" integer NOT NULL,
	"costEstimate" real,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_event_tenant_id_index" ON "usage_event" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "usage_event_eventType_index" ON "usage_event" USING btree ("eventType");--> statement-breakpoint
CREATE INDEX "usage_event_createdAt_index" ON "usage_event" USING btree ("createdAt");