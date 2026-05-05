import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { users } from "../src/db/schema"
import { eq } from "drizzle-orm"

const adminEmailRaw = process.env.ADMIN_EMAIL

if (!adminEmailRaw) {
  console.error("Error: ADMIN_EMAIL environment variable is not set.")
  console.error("Add ADMIN_EMAIL=your@email.com to your .env.local file.")
  process.exit(1)
}

// Re-assign after the guard so TypeScript narrows to `string`
const adminEmail: string = adminEmailRaw

const sqlite = new Database("sqlite.db")
const db = drizzle(sqlite)

async function seed() {
  // Check if the admin already exists
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, adminEmail))
    .get()

  if (existing) {
    console.log(`Admin account already exists for ${adminEmail}. Skipping.`)
    sqlite.close()
    return
  }

  // Create the admin account
  await db.insert(users).values({
    email: adminEmail,
    role: "admin",
    hasLoggedIn: false,
  })

  console.log(`Admin account created for ${adminEmail}.`)
  sqlite.close()
}

seed().catch((err) => {
  console.error("Seed script failed:", err)
  sqlite.close()
  process.exit(1)
})
