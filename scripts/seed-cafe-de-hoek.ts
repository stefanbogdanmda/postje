import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { users, clients } from "../src/db/schema"
import { eq } from "drizzle-orm"
import { CAFE_DE_HOEK_CLIENT_ID } from "../src/data/clients/cafe-de-hoek"

const sqlite = new Database("sqlite.db")
sqlite.pragma("foreign_keys = ON")
const db = drizzle(sqlite)

async function seed() {
  // Check if the client already exists
  const existing = await db
    .select()
    .from(clients)
    .where(eq(clients.id, CAFE_DE_HOEK_CLIENT_ID))
    .get()

  if (existing) {
    console.log(
      `Café de Hoek client already exists (${CAFE_DE_HOEK_CLIENT_ID}). Skipping.`
    )
    sqlite.close()
    return
  }

  // Find the admin user to attach the client to
  const admin = await db
    .select()
    .from(users)
    .where(eq(users.role, "admin"))
    .get()

  if (!admin) {
    console.error("Error: No admin user found. Run seed:admin first.")
    sqlite.close()
    process.exit(1)
  }

  // Check if admin already has a client row
  const existingClientForAdmin = await db
    .select()
    .from(clients)
    .where(eq(clients.userId, admin.id))
    .get()

  if (existingClientForAdmin) {
    console.log(
      `Admin already has a client row (${existingClientForAdmin.id}). ` +
        `Update its ID to ${CAFE_DE_HOEK_CLIENT_ID} manually if needed, ` +
        `or delete and re-run.`
    )
    sqlite.close()
    return
  }

  await db.insert(clients).values({
    id: CAFE_DE_HOEK_CLIENT_ID,
    userId: admin.id,
    businessName: "Café de Hoek",
    location: "Arnhem, Netherlands",
    industry: "Café / lunchroom",
    businessType: "Café/lunchroom (no dinner service)",
    productsServices:
      "Homemade appeltaart, daily soups, fresh sandwiches, specialty coffee, fresh-pressed juices",
  })

  console.log(
    `Café de Hoek client created with ID: ${CAFE_DE_HOEK_CLIENT_ID}`
  )
  sqlite.close()
}

seed().catch((err) => {
  console.error("Seed script failed:", err)
  sqlite.close()
  process.exit(1)
})
