CREATE TABLE "publish_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"postId" text NOT NULL,
	"attemptedAt" timestamp with time zone NOT NULL,
	"attemptedBy" text NOT NULL,
	"metaPostId" text,
	"success" boolean NOT NULL,
	"errorClass" text,
	"errorCode" text,
	"errorMessage" text,
	"requestDurationMs" integer
);
--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_postId_posts_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publish_attempts_post_idx" ON "publish_attempts" USING btree ("postId");