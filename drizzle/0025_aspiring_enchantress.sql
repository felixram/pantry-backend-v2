ALTER TABLE "location" ADD COLUMN "count_reminder_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "count_reminder_day" integer;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "count_reminder_time" text;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "count_reminder_tz" text;