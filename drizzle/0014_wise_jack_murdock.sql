CREATE TABLE "po_counter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "po_counter_year_unique" UNIQUE("year")
);
--> statement-breakpoint
ALTER TABLE "supplier" ALTER COLUMN "supplier_type" SET DEFAULT 'PRIMARY';--> statement-breakpoint
ALTER TABLE "purchase_order" ADD COLUMN "po_number" varchar(20);--> statement-breakpoint
-- Backfill PO numbers based on creation date
WITH po_numbered AS (
  SELECT
    id,
    'PO-' ||
    EXTRACT(YEAR FROM "createdAt") || '-' ||
    LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY EXTRACT(YEAR FROM "createdAt")
        ORDER BY "createdAt"
      )::text,
      3,
      '0'
    ) as generated_po_number
  FROM purchase_order
  WHERE po_number IS NULL
)
UPDATE purchase_order
SET po_number = po_numbered.generated_po_number
FROM po_numbered
WHERE purchase_order.id = po_numbered.id;
--> statement-breakpoint
-- Initialize po_counter based on existing POs
INSERT INTO po_counter (year, last_sequence)
SELECT
  EXTRACT(YEAR FROM "createdAt")::integer as year,
  COUNT(*)::integer as last_sequence
FROM purchase_order
GROUP BY EXTRACT(YEAR FROM "createdAt")
ON CONFLICT (year) DO UPDATE
SET last_sequence = EXCLUDED.last_sequence;
--> statement-breakpoint
-- Now add NOT NULL constraint and unique constraint
ALTER TABLE "purchase_order" ALTER COLUMN "po_number" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "purchase_order_po_number_index" ON "purchase_order" USING btree ("po_number");--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_po_number_unique" UNIQUE("po_number");