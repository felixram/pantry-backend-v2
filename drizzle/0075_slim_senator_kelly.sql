DROP INDEX "invoice_tenant_email_id_unique";--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "resend_attachment_id" text;--> statement-breakpoint
CREATE INDEX "invoice_tenant_email_id_idx" ON "invoice" USING btree ("tenant_id","resend_email_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_tenant_email_attachment_unique" ON "invoice" USING btree ("tenant_id","resend_email_id","resend_attachment_id");