CREATE TABLE "user_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actorUserId" uuid NOT NULL,
	"targetUserId" uuid,
	"targetEmail" text NOT NULL,
	"targetName" text NOT NULL,
	"targetLocationId" uuid,
	"reason" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_audit" ADD CONSTRAINT "user_audit_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_audit" ADD CONSTRAINT "user_audit_actorUserId_user_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_audit" ADD CONSTRAINT "user_audit_targetUserId_user_id_fk" FOREIGN KEY ("targetUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_audit" ADD CONSTRAINT "user_audit_targetLocationId_location_id_fk" FOREIGN KEY ("targetLocationId") REFERENCES "public"."location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_audit_tenant_id_index" ON "user_audit" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "user_audit_createdAt_index" ON "user_audit" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "user_audit_targetUserId_index" ON "user_audit" USING btree ("targetUserId");--> statement-breakpoint
CREATE INDEX "user_audit_actorUserId_index" ON "user_audit" USING btree ("actorUserId");