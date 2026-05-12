CREATE TABLE "deletion_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"cancelToken" text NOT NULL,
	"requestedAt" timestamp with time zone NOT NULL,
	"scheduledFor" timestamp with time zone NOT NULL,
	"cancelledAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	CONSTRAINT "deletion_requests_userId_unique" UNIQUE("userId"),
	CONSTRAINT "deletion_requests_cancelToken_unique" UNIQUE("cancelToken")
);
--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deletion_requests_due_idx" ON "deletion_requests" USING btree ("scheduledFor");