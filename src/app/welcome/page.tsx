import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import SignOutButton from "@/components/sign-out-button"

export default async function WelcomePage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  // Admin should never see the welcome page
  if (session.user.role === "admin") {
    redirect("/admin")
  }

  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
    }}>
      <div style={{ maxWidth: "480px", textAlign: "center" }}>
        <h1 style={{ fontSize: "28px", marginBottom: "16px" }}>
          Welkom bij Social AI
        </h1>
        <p style={{ color: "#666", lineHeight: 1.6, marginBottom: "32px" }}>
          Fijn dat je er bent! Je account is klaar.
          Ga naar je dashboard om je posts te bekijken.
        </p>
        <a
          href="/dashboard"
          style={{
            display: "inline-block",
            padding: "12px 32px",
            backgroundColor: "#1a1a1a",
            color: "#fff",
            borderRadius: "6px",
            textDecoration: "none",
            fontWeight: 500,
          }}
        >
          Ga verder
        </a>
        <div style={{ marginTop: "24px" }}>
          <SignOutButton label="Log uit" />
        </div>
      </div>
    </main>
  )
}
