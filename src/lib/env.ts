/**
 * Unified environment variable validation.
 *
 * Import this module early (e.g. in layout.tsx or API routes) to fail fast
 * when required environment variables are missing. Each variable is validated
 * once at module load time and exported as a typed object.
 */

interface RequiredVar {
  key: string
  description: string
}

interface OptionalVar {
  key: string
  description: string
  fallback: string
}

const REQUIRED_VARS: RequiredVar[] = [
  { key: "DATABASE_URL", description: "Neon Postgres connection string" },
  { key: "AUTH_RESEND_KEY", description: "Resend API key for magic link emails" },
  { key: "AUTH_SECRET", description: "NextAuth session signing secret" },
  { key: "CRON_SECRET", description: "Bearer token for Vercel Cron job auth" },
  { key: "ANTHROPIC_API_KEY", description: "Claude API key for post generation" },
]

const OPTIONAL_VARS: OptionalVar[] = [
  { key: "NEXT_PUBLIC_APP_URL", description: "Public app URL", fallback: "http://localhost:3000" },
  { key: "EMAIL_FROM", description: "Sender email address", fallback: "onboarding@resend.dev" },
  { key: "ADMIN_EMAIL", description: "Admin notification email", fallback: "" },
  { key: "META_APP_ID", description: "Meta/Facebook app ID", fallback: "" },
  { key: "META_APP_SECRET", description: "Meta/Facebook app secret", fallback: "" },
  { key: "META_OAUTH_REDIRECT_URI", description: "Meta OAuth redirect URI", fallback: "" },
  { key: "META_TOKEN_ENCRYPTION_KEY", description: "AES-256 key for Meta token encryption (base64)", fallback: "" },
  { key: "META_GRAPH_VERSION", description: "Meta Graph API version", fallback: "v21.0" },
  { key: "BLOB_READ_WRITE_TOKEN", description: "Vercel Blob storage token", fallback: "" },
]

export interface EnvValidationError {
  key: string
  description: string
}

/**
 * Validate that all required environment variables are present.
 * Returns a list of missing variables (empty if all are set).
 */
export function validateEnv(): EnvValidationError[] {
  const missing: EnvValidationError[] = []

  for (const { key, description } of REQUIRED_VARS) {
    const value = process.env[key]
    if (!value || value.trim() === "") {
      missing.push({ key, description })
    }
  }

  return missing
}

/**
 * Validate and throw if any required variables are missing.
 * Call this at application startup to fail fast.
 */
export function assertEnv(): void {
  const missing = validateEnv()

  if (missing.length > 0) {
    const details = missing
      .map((m) => `  - ${m.key}: ${m.description}`)
      .join("\n")

    throw new Error(
      `Missing required environment variables:\n${details}\n\nAdd them to .env.local (development) or Vercel environment settings (production).`
    )
  }
}

/**
 * Get an optional environment variable with a fallback value.
 */
export function getOptionalEnv(key: string): string {
  const opt = OPTIONAL_VARS.find((v) => v.key === key)
  const value = process.env[key]

  if (value && value.trim() !== "") {
    return value
  }

  return opt?.fallback ?? ""
}

/**
 * Lists all registered environment variables and their status.
 * Useful for debugging — values are masked for security.
 */
export function getEnvStatus(): Array<{
  key: string
  description: string
  required: boolean
  present: boolean
}> {
  const required = REQUIRED_VARS.map(({ key, description }) => ({
    key,
    description,
    required: true,
    present: Boolean(process.env[key]?.trim()),
  }))

  const optional = OPTIONAL_VARS.map(({ key, description }) => ({
    key,
    description,
    required: false,
    present: Boolean(process.env[key]?.trim()),
  }))

  return [...required, ...optional]
}
