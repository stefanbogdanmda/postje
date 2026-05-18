CREATE TABLE "meta_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"pageId" text NOT NULL,
	"pageName" text NOT NULL,
	"instagramBusinessId" text,
	"encryptedAccessToken" text NOT NULL,
	"grantedScopes" text NOT NULL,
	"connectedAt" timestamp with time zone NOT NULL,
	"lastValidatedAt" timestamp with time zone,
	"expiresAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_clientId_clients_id_fk" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_connections_client_page_idx" ON "meta_connections" USING btree ("clientId","pageId");