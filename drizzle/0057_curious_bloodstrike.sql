CREATE TABLE "category_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"categoryId" uuid,
	"categoryName" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action" text NOT NULL,
	"userId" uuid NOT NULL,
	"reason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "category_audit" ADD CONSTRAINT "category_audit_categoryId_category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_audit" ADD CONSTRAINT "category_audit_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_audit" ADD CONSTRAINT "category_audit_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_audit_categoryId_index" ON "category_audit" USING btree ("categoryId");--> statement-breakpoint
CREATE INDEX "category_audit_tenant_id_index" ON "category_audit" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "category_audit_createdAt_index" ON "category_audit" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "category_deletedAt_index" ON "category" USING btree ("deletedAt");