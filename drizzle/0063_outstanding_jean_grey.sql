ALTER TABLE "location" ADD COLUMN "last_reminder_sent_week_identifier" text;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "last_reminder_sent_at" timestamp with time zone;