ALTER TABLE "inventory_count_session" ADD COLUMN "submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "inventory_count_session" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "inventory_count_entry" ADD COLUMN "reviewed_qty" real;--> statement-breakpoint
ALTER TABLE "inventory_count_session" ADD CONSTRAINT "inventory_count_session_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;