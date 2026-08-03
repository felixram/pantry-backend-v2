CREATE TABLE "purchase_order_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchaseOrderId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"fieldChanged" text NOT NULL,
	"oldValue" text NOT NULL,
	"newValue" text NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_order" ALTER COLUMN "status" SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE "purchase_order" ALTER COLUMN "status" SET DEFAULT 'DRAFT';--> statement-breakpoint
ALTER TABLE "purchase_order_audit" ADD CONSTRAINT "purchase_order_audit_purchaseOrderId_purchase_order_id_fk" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."purchase_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_audit" ADD CONSTRAINT "purchase_order_audit_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;