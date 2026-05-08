import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import * as schema from "@/db/schema"

export type TestDb = ReturnType<typeof createTestDb>

export function createTestDb() {
  const sqlite = new Database(":memory:")
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: "src/db/migrations" })
  return db
}

/**
 * Insert a minimal client row for testing. Returns the client ID.
 */
export function seedTestClient(db: TestDb, clientId: string = "test-client-001") {
  const userId = `user-${clientId}`

  db.insert(schema.users).values({
    id: userId,
    email: `${clientId}@example.com`,
    name: "Test User",
    role: "client",
  }).run()

  db.insert(schema.clients).values({
    id: clientId,
    userId,
    businessName: "Test Café",
  }).run()

  return clientId
}

/**
 * Insert a minimal photo row for testing foreign key references.
 * Returns the photo ID.
 */
export function seedTestPhoto(db: TestDb, clientId: string, photoId: string) {
  db.insert(schema.photos).values({
    id: photoId,
    clientId,
    blobUrl: `https://example.com/${photoId}.jpg`,
    originalFilename: `${photoId}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 1024,
  }).run()

  return photoId
}
