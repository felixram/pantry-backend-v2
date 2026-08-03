DROP INDEX "invoice_resend_message_id_index";--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_tenant_message_unique" ON "invoice" USING btree ("tenant_id","resend_message_id");