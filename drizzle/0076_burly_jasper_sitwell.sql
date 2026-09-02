ALTER TABLE "stock_movement" ADD COLUMN "reason_code" varchar(24);--> statement-breakpoint
CREATE INDEX "stock_movement_reason_code_index" ON "stock_movement" USING btree ("reason_code");