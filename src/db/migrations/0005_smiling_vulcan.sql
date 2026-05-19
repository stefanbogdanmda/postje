CREATE TABLE "post_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"postId" text NOT NULL,
	"clientId" text NOT NULL,
	"reason" text,
	"flaggedAt" timestamp with time zone NOT NULL,
	"resolvedAt" timestamp with time zone,
	"resolvedBy" text
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "timezone" text DEFAULT 'Europe/Amsterdam' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "toneOfVoice" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "targetCustomers" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "brandPersonality" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "bannedPhrases" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "examplePosts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "calibrationStartDate" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "publishMode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_flags" ADD CONSTRAINT "post_flags_postId_posts_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_flags" ADD CONSTRAINT "post_flags_clientId_clients_id_fk" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_flags_post_idx" ON "post_flags" USING btree ("postId");