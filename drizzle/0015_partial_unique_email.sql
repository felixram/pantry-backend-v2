-- Drop the existing UNIQUE constraint on email (applies to all rows including soft-deleted)
ALTER TABLE "user" DROP CONSTRAINT "user_email_unique";

--> statement-breakpoint

-- Create a partial unique index that only enforces uniqueness for non-deleted users
-- This allows deleted users to have the same email as new users
CREATE UNIQUE INDEX "user_email_unique_active" ON "user"("email") WHERE "deletedAt" IS NULL;
