CREATE TABLE "meta_deletion_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"confirmationCode" text NOT NULL,
	"metaUserId" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"receivedAt" timestamp with time zone NOT NULL,
	"resolvedAt" timestamp with time zone,
	CONSTRAINT "meta_deletion_requests_confirmationCode_unique" UNIQUE("confirmationCode")
);
--> statement-breakpoint
CREATE INDEX "meta_deletion_requests_code_idx" ON "meta_deletion_requests" USING btree ("confirmationCode");