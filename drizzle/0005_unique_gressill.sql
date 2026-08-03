ALTER TABLE "product_version" DROP CONSTRAINT "product_version_productId_product_id_fk";
--> statement-breakpoint
ALTER TABLE "product_version" ADD CONSTRAINT "product_version_productId_product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;