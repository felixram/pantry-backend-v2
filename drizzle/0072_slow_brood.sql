ALTER TABLE "tenant" ADD COLUMN "default_currency" varchar(3) DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD COLUMN "currency" varchar(3);--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "currency" varchar(3);--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "currency" varchar(3);