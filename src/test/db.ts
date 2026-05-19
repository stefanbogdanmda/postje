import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import * as schema from "@/db/schema"

export type TestDb = Awaited<ReturnType<typeof createTestDb>>

export async function createTestDb() {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: "src/db/migrations" })
  return db
}

/**
 * Insert a minimal client row for testing. Returns the client ID.
 */
export async function seedTestClient(
  db: TestDb,
  clientId: string = "test-client-001"
) {
  const userId = `user-${clientId}`

  await db.insert(schema.users).values({
    id: userId,
    email: `${clientId}@example.com`,
    name: "Test User",
    role: "client",
  })

  await db.insert(schema.clients).values({
    id: clientId,
    userId,
    businessName: "Test Café",
  })

  return clientId
}

/**
 * Insert a minimal photo row for testing foreign key references.
 * Returns the photo ID.
 */
export async function seedTestPhoto(
  db: TestDb,
  clientId: string,
  photoId: string
) {
  await db.insert(schema.photos).values({
    id: photoId,
    clientId,
    blobUrl: `https://example.com/${photoId}.jpg`,
    originalFilename: `${photoId}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 1024,
  })

  return photoId
}

/**
 * Insert a Meta connection row for testing. Encrypts a placeholder
 * token so the row is realistic.
 */
export async function seedMetaConnection(
  db: TestDb,
  clientId: string,
  overrides: Partial<{
    pageId: string
    pageName: string
    instagramBusinessId: string | null
    accessTokenPlaintext: string
    grantedScopes: string
  }> = {}
) {
  if (!process.env.META_TOKEN_ENCRYPTION_KEY) {
    process.env.META_TOKEN_ENCRYPTION_KEY =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  }
  const { encryptToken } = await import("@/lib/meta/crypto")
  const accessTokenPlaintext =
    overrides.accessTokenPlaintext ?? "PAGE_TOKEN_PLAINTEXT"
  await db.insert(schema.metaConnections).values({
    clientId,
    pageId: overrides.pageId ?? "PAGE_1",
    pageName: overrides.pageName ?? "Test Page",
    instagramBusinessId: overrides.instagramBusinessId ?? "IG_1",
    encryptedAccessToken: encryptToken(accessTokenPlaintext),
    grantedScopes:
      overrides.grantedScopes ?? "pages_manage_posts,instagram_content_publish",
  })
}
