CREATE TABLE "supplier_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplierId" uuid,
	"supplierName" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action" text NOT NULL,
	"userId" uuid NOT NULL,
	"reason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_audit" ADD CONSTRAINT "supplier_audit_supplierId_supplier_id_fk" FOREIGN KEY ("supplierId") REFERENCES "public"."supplier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_audit" ADD CONSTRAINT "supplier_audit_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_audit" ADD CONSTRAINT "supplier_audit_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_audit_supplierId_index" ON "supplier_audit" USING btree ("supplierId");--> statement-breakpoint
CREATE INDEX "supplier_audit_tenant_id_index" ON "supplier_audit" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "supplier_audit_createdAt_index" ON "supplier_audit" USING btree ("createdAt");