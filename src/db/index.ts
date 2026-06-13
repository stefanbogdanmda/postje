import { Pool, neonConfig } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-serverless"
import ws from "ws"
import * as schema from "./schema"

// The Neon serverless Pool talks to the database over a WebSocket. On Node
// (Vercel's serverless functions) there is no guaranteed global WebSocket, so we
// hand it the `ws` implementation explicitly. Without this the pool can fail to
// open a connection on Node — the root cause behind earlier silent migration failures.
neonConfig.webSocketConstructor = ws

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set")
}

// Pool is reused across function invocations within the same instance.
// Neon serverless handles connection pooling on its side.
const pool = new Pool({ connectionString: databaseUrl })

export const db = drizzle(pool, { schema })
