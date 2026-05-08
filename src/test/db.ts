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
  const userId = "test-user-001"

  db.insert(schema.users).values({
    id: userId,
    email: "test@example.com",
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
