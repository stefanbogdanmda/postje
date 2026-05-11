import { db } from "../src/db"
import { users } from "../src/db/schema"
import { eq } from "drizzle-orm"

const adminEmailRaw = process.env.ADMIN_EMAIL

if (!adminEmailRaw) {
  console.error("Error: ADMIN_EMAIL environment variable is not set.")
  console.error("Add ADMIN_EMAIL=your@email.com to your .env.local file.")
  process.exit(1)
}

// Re-assign after the guard so TypeScript narrows to `string`
const adminEmail: string = adminEmailRaw.toLowerCase()

async function seed() {
  // Check if the admin already exists
  const existingRows = await db
    .select()
    .from(users)
    .where(eq(users.email, adminEmail))
    .limit(1)

  if (existingRows.length > 0) {
    console.log(`Admin account already exists for ${adminEmail}. Skipping.`)
    return
  }

  // Create the admin account
  await db.insert(users).values({
    email: adminEmail,
    role: "admin",
    hasLoggedIn: false,
  })

  console.log(`Admin account created for ${adminEmail}.`)
}

seed().catch((err) => {
  console.error("Seed script failed:", err)
  process.exit(1)
})
