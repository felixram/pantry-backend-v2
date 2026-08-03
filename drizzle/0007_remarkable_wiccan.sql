ALTER TABLE "stock" DROP CONSTRAINT "stock_productId_product_id_fk";
--> statement-breakpoint
ALTER TABLE "stock" ADD CONSTRAINT "stock_productId_product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;