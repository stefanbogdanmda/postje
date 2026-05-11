import { db } from "../src/db"
import { users, clients } from "../src/db/schema"
import { eq } from "drizzle-orm"
import { CAFE_DE_HOEK_CLIENT_ID } from "../src/data/clients/cafe-de-hoek"

async function seed() {
  // Check if the client already exists
  const existingRows = await db
    .select()
    .from(clients)
    .where(eq(clients.id, CAFE_DE_HOEK_CLIENT_ID))
    .limit(1)

  if (existingRows.length > 0) {
    console.log(
      `Café de Hoek client already exists (${CAFE_DE_HOEK_CLIENT_ID}). Skipping.`
    )
    return
  }

  // Find the admin user to attach the client to
  const adminRows = await db
    .select()
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1)
  const admin = adminRows[0]

  if (!admin) {
    console.error("Error: No admin user found. Run seed:admin first.")
    process.exit(1)
  }

  // Check if admin already has a client row
  const existingClientRows = await db
    .select()
    .from(clients)
    .where(eq(clients.userId, admin.id))
    .limit(1)
  const existingClientForAdmin = existingClientRows[0]

  if (existingClientForAdmin) {
    console.log(
      `Admin already has a client row (${existingClientForAdmin.id}). ` +
        `Update its ID to ${CAFE_DE_HOEK_CLIENT_ID} manually if needed, ` +
        `or delete and re-run.`
    )
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
}

seed().catch((err) => {
  console.error("Seed script failed:", err)
  process.exit(1)
})
