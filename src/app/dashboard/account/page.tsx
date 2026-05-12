import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { getActiveDeletionRequest } from "@/lib/account/deletion-request"
import ExportDataButton from "@/components/dashboard/export-data-button"
import DeleteAccountButton from "@/components/dashboard/delete-account-button"
import PendingDeletionBanner from "@/components/dashboard/pending-deletion-banner"

export default async function AccountPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login")
  }

  const pending = await getActiveDeletionRequest(db, session.user.id)

  return (
    <main
      style={{
        maxWidth: "44rem",
        margin: "0 auto",
        padding: "2.5rem 1.5rem",
        fontFamily: "sans-serif",
        color: "#1a1a1a",
      }}
    >
      <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.75rem" }}>
        Account &amp; privacy
      </h1>
      <p style={{ margin: "0 0 2rem", color: "#666", fontSize: "0.95rem" }}>
        Hier kun je je gegevens downloaden of je account verwijderen.
      </p>

      {pending && <PendingDeletionBanner scheduledFor={pending.scheduledFor} />}

      <section
        style={{
          padding: "1.5rem",
          border: "1px solid #e6e6e6",
          borderRadius: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.25rem" }}>
          Mijn gegevens exporteren
        </h2>
        <p style={{ margin: "0 0 1rem", lineHeight: 1.6 }}>
          Download alles wat we van je opslaan als JSON-bestand: je
          businessprofiel, geüploade foto&apos;s, en alle gegenereerde posts.
        </p>
        <ExportDataButton />
      </section>

      <section
        style={{
          padding: "1.5rem",
          border: "1px solid #e6e6e6",
          borderRadius: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.25rem" }}>
          Mijn account verwijderen
        </h2>
        <p style={{ margin: "0 0 1rem", lineHeight: 1.6 }}>
          Als je je account verwijdert, wis je je businessprofiel, je foto&apos;s,
          en alle posts. We wachten 24 uur na je verzoek &mdash; tot dan kun je
          het nog annuleren via een knop in je mail of in dit dashboard.
        </p>
        {!pending && <DeleteAccountButton />}
        {pending && (
          <p style={{ margin: 0, color: "#666", fontSize: "0.875rem" }}>
            Je hebt al een verzoek lopen &mdash; zie de melding bovenaan.
          </p>
        )}
      </section>

      <section
        style={{
          padding: "1.5rem",
          border: "1px solid #e6e6e6",
          borderRadius: "0.75rem",
          background: "#fafafa",
        }}
      >
        <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.125rem" }}>
          Wat slaan we van je op?
        </h2>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", lineHeight: 1.7 }}>
          <li>Je businessprofiel (naam, locatie, branche, producten/diensten)</li>
          <li>De foto&apos;s die je hebt geüpload en de AI-analyse ervan</li>
          <li>Alle gegenereerde posts en hun status (concept, goedgekeurd, gepubliceerd)</li>
          <li>Je inloggegevens (e-mailadres) en sessies</li>
        </ul>
      </section>
    </main>
  )
}
