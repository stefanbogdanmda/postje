CREATE TABLE "accounts" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" bigint,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"businessName" text NOT NULL,
	"location" text,
	"industry" text,
	"businessType" text,
	"productsServices" text,
	"logoUrl" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "clients_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "deletion_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"deletedUserEmail" text NOT NULL,
	"deletedUserId" text NOT NULL,
	"deletedBy" text NOT NULL,
	"deletedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"blobUrl" text NOT NULL,
	"originalFilename" text NOT NULL,
	"mimeType" text NOT NULL,
	"sizeBytes" integer NOT NULL,
	"analysis" jsonb,
	"analyzedAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"platform" text NOT NULL,
	"scheduledDate" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content" text NOT NULL,
	"photoId" text,
	"reasoning" text NOT NULL,
	"publishAt" timestamp with time zone,
	"rejectionCount" integer DEFAULT 0 NOT NULL,
	"approvedAt" timestamp with time zone,
	"rejectedAt" timestamp with time zone,
	"publishedAt" timestamp with time zone,
	"publishError" text,
	"firstSeenAt" timestamp with time zone,
	"alertedAt" timestamp with time zone,
	"regenLimitAlertedAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text DEFAULT 'client' NOT NULL,
	"emailVerified" timestamp with time zone,
	"hasLoggedIn" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"image" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationTokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verificationTokens_identifier_token_pk" PRIMARY KEY("identifier","token"),
	CONSTRAINT "verificationTokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_clientId_clients_id_fk" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_clientId_clients_id_fk" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_photoId_photos_id_fk" FOREIGN KEY ("photoId") REFERENCES "public"."photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_client_date_idx" ON "posts" USING btree ("clientId","scheduledDate");--> statement-breakpoint
CREATE INDEX "posts_status_publish_idx" ON "posts" USING btree ("status","publishAt");--> statement-breakpoint
CREATE INDEX "posts_stale_alert_idx" ON "posts" USING btree ("status","alertedAt","firstSeenAt");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_client_date_platform_idx" ON "posts" USING btree ("clientId","scheduledDate","platform");