ALTER TABLE "purchase_order" ADD COLUMN "is_unlocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD COLUMN "unlocked_by" uuid;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD COLUMN "unlocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_unlocked_by_user_id_fk" FOREIGN KEY ("unlocked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;