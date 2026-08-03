ALTER TABLE "user" ADD COLUMN "location_id" uuid;--> statement-breakpoint
CREATE INDEX "user_location_id_index" ON "user" USING btree ("location_id");