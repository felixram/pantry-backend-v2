ALTER TABLE "invoice" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "manual_entry" boolean DEFAULT false NOT NULL;