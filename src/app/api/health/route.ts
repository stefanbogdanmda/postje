import { NextResponse } from "next/server"
import { db } from "@/db"
import { sql } from "drizzle-orm"

/**
 * Health check endpoint for uptime monitoring.
 *
 * Returns 200 with status info when the app and database are healthy.
 * Returns 503 when the database is unreachable.
 *
 * No authentication required — this endpoint is used by external
 * monitoring services (e.g. Vercel, UptimeRobot).
 */
export async function GET() {
  const timestamp = new Date().toISOString()

  try {
    await db.execute(sql`SELECT 1`)

    return NextResponse.json({
      status: "ok",
      timestamp,
      database: "connected",
    })
  } catch {
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp,
        database: "unreachable",
      },
      { status: 503 }
    )
  }
}
