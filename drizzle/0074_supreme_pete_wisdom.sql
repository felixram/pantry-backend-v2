CREATE TABLE "email_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"email_type" text NOT NULL,
	"to_email" text NOT NULL,
	"from_email" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"idempotency_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"provider_message_id" text,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_queue" ADD CONSTRAINT "email_queue_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_queue_drain_idx" ON "email_queue" USING btree ("priority","next_attempt_at") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "email_queue_idempotency_key_idx" ON "email_queue" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "email_queue_status_idx" ON "email_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_queue_tenant_idx" ON "email_queue" USING btree ("tenant_id");