ALTER TABLE "tenant_invoice_config" DROP COLUMN "max_daily_extractions";--> statement-breakpoint
ALTER TABLE "tenant_invoice_config" DROP COLUMN "max_monthly_extractions";--> statement-breakpoint
ALTER TABLE "tenant_invoice_config" DROP COLUMN "daily_extractions_used";--> statement-breakpoint
ALTER TABLE "tenant_invoice_config" DROP COLUMN "daily_extractions_reset_at";--> statement-breakpoint
ALTER TABLE "tenant_invoice_config" DROP COLUMN "monthly_extractions_used";--> statement-breakpoint
ALTER TABLE "tenant_invoice_config" DROP COLUMN "monthly_extractions_reset_at";