ALTER TABLE "tenant_invoice_config" ADD COLUMN "max_daily_extractions" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_invoice_config" ADD COLUMN "max_monthly_extractions" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_invoice_config" ADD COLUMN "daily_extractions_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_invoice_config" ADD COLUMN "daily_extractions_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_invoice_config" ADD COLUMN "monthly_extractions_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_invoice_config" ADD COLUMN "monthly_extractions_reset_at" timestamp with time zone;