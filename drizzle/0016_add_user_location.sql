-- Add location_id column to user table (nullable for admins)
ALTER TABLE "user" ADD COLUMN "location_id" uuid;

-- Add foreign key constraint
ALTER TABLE "user" ADD CONSTRAINT "user_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "location"("id");

-- Create index for filtering performance
CREATE INDEX "user_location_id_idx" ON "user"("location_id");

-- Auto-assign existing USER role accounts to first active location
UPDATE "user"
SET "location_id" = (SELECT id FROM "location" WHERE active = true ORDER BY "createdAt" ASC LIMIT 1)
WHERE role = 'USER' AND "location_id" IS NULL;
