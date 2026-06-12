// Next.js runs `register()` once when the server process starts. We use it to
// fail fast when a required environment variable is missing, instead of letting
// the app boot and then crash on the first request that needs the secret.
export async function register() {
  // Only run on the Node.js server runtime — not the Edge runtime, where these
  // server secrets are not present and assertEnv would throw spuriously.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertEnv } = await import("@/lib/env")
    assertEnv()
  }
}
