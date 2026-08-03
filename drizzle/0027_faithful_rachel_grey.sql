CREATE INDEX "location_deletedAt_index" ON "location" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "product_activeVersionId_index" ON "product" USING btree ("activeVersionId");--> statement-breakpoint
CREATE INDEX "product_deletedAt_index" ON "product" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "purchase_order_deletedAt_index" ON "purchase_order" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "purchase_order_item_product_id_index" ON "purchase_order_item" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "supplier_deletedAt_index" ON "supplier" USING btree ("deletedAt");