CREATE TABLE "auth_throttle" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"requestedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_throttle_key_requestedAt_idx" ON "auth_throttle" USING btree ("key","requestedAt");