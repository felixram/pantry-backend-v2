ALTER TABLE "user" DROP CONSTRAINT "user_invitation_token_unique";--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_password_reset_token_unique";--> statement-breakpoint
DROP INDEX "user_invitation_token_index";--> statement-breakpoint
DROP INDEX "user_password_reset_token_index";--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "clerk_org_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "clerk_user_id" text;--> statement-breakpoint
CREATE INDEX "tenant_clerk_org_id_index" ON "tenant" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX "user_clerk_user_id_index" ON "user" USING btree ("clerk_user_id");--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "password";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "invitation_token";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "invitation_expires_at";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "password_reset_token";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "password_reset_expires_at";--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_clerk_org_id_unique" UNIQUE("clerk_org_id");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_clerk_user_id_unique" UNIQUE("clerk_user_id");