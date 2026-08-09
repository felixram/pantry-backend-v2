CREATE TABLE "product_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"productId" uuid,
	"productName" text NOT NULL,
	"productSku" text,
	"tenant_id" uuid NOT NULL,
	"action" text NOT NULL,
	"userId" uuid NOT NULL,
	"reason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_audit" ADD CONSTRAINT "product_audit_productId_product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_audit" ADD CONSTRAINT "product_audit_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_audit" ADD CONSTRAINT "product_audit_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_audit_productId_index" ON "product_audit" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "product_audit_tenant_id_index" ON "product_audit" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "product_audit_createdAt_index" ON "product_audit" USING btree ("createdAt");