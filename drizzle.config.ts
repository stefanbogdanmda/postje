import { config as loadEnv } from "dotenv"
import { defineConfig } from "drizzle-kit"

loadEnv({ path: ".env.local" })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL environment variable is not set. Add it to .env.local for local development, or ensure it is present in your deployment environment."
  )
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: databaseUrl,
  },
})
