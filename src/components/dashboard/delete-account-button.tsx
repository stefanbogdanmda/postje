"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { requestAccountDeletionAction } from "@/app/dashboard/account/actions"

export default function DeleteAccountButton() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const router = useRouter()

  function openDialog() {
    setError(null)
    dialogRef.current?.showModal()
  }

  function closeDialog() {
    dialogRef.current?.close()
  }

  function handleConfirm() {
    startTransition(async () => {
      const result = await requestAccountDeletionAction()
      closeDialog()
      if (!result.success) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        disabled={pending}
        style={{
          padding: "0.625rem 1rem",
          background: "#b00020",
          color: "#fff",
          border: "none",
          borderRadius: "0.375rem",
          cursor: pending ? "not-allowed" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        Account verwijderen
      </button>

      <dialog
        ref={dialogRef}
        style={{
          padding: "1.5rem",
          borderRadius: "0.75rem",
          border: "1px solid #ccc",
          maxWidth: "28rem",
        }}
      >
        <h3 style={{ margin: "0 0 0.75rem" }}>Weet je het zeker?</h3>
        <p style={{ margin: "0 0 1rem", lineHeight: 1.5 }}>
          Je krijgt een bevestigingsmail. Daarna heb je 24 uur om je te
          bedenken voordat alles definitief verdwijnt.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={closeDialog}
            disabled={pending}
            style={{
              padding: "0.5rem 0.875rem",
              background: "#eee",
              color: "#1a1a1a",
              border: "none",
              borderRadius: "0.375rem",
              cursor: "pointer",
            }}
          >
            Annuleren
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending}
            style={{
              padding: "0.5rem 0.875rem",
              background: "#b00020",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              cursor: pending ? "not-allowed" : "pointer",
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? "Verzenden…" : "Ja, verwijder mijn account"}
          </button>
        </div>
      </dialog>

      {error && (
        <p style={{ margin: "0.75rem 0 0", color: "#b00020", fontSize: "0.875rem" }}>
          {error}
        </p>
      )}
    </>
  )
}
