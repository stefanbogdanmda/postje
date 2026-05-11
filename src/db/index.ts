import { Pool } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-serverless"
import * as schema from "./schema"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set")
}

// Pool is reused across function invocations within the same instance.
// Neon serverless handles connection pooling on its side.
const pool = new Pool({ connectionString: databaseUrl })

export const db = drizzle(pool, { schema })
