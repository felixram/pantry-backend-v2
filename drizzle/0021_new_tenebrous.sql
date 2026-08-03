ALTER TABLE "user" ADD COLUMN "password_reset_token" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "password_reset_expires_at" timestamp;--> statement-breakpoint
CREATE INDEX "user_password_reset_token_index" ON "user" USING btree ("password_reset_token");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_password_reset_token_unique" UNIQUE("password_reset_token");