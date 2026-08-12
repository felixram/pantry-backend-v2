ALTER TABLE "inventory_count_session" ADD COLUMN "rejected_at" timestamp;--> statement-breakpoint
ALTER TABLE "inventory_count_session" ADD COLUMN "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "inventory_count_session" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "inventory_count_entry" ADD COLUMN "unit_conversion_factor" real;--> statement-breakpoint
ALTER TABLE "inventory_count_session" ADD CONSTRAINT "inventory_count_session_rejected_by_user_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;