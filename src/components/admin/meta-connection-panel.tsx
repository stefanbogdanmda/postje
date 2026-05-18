"use client"

import { useState, useTransition } from "react"
import {
  getMetaConnectUrlAction,
  disconnectMetaAction,
} from "@/app/admin/clients/[id]/meta-actions"

interface ConnectedState {
  pageName: string
  instagramBusinessId: string | null
  connectedAt: Date
}

interface MetaConnectionPanelProps {
  clientId: string
  connection: ConnectedState | null
  flashKind: "connected" | "error" | null
  flashReason: string | null
}

const errorReasonText: Record<string, string> = {
  "no-page": "Het gekoppelde Facebook-account heeft geen Pagina.",
  "meta-exchange-failed": "Meta gaf een fout terug tijdens het koppelen.",
  expired: "De koppellink is verlopen. Probeer het opnieuw.",
  "bad-signature": "De koppellink is ongeldig. Probeer het opnieuw.",
  malformed: "De koppellink kon niet worden gelezen.",
  "missing-params": "De koppeling werd onderbroken voordat Meta klaar was.",
  forbidden: "Je hebt geen toegang tot deze actie.",
}

export default function MetaConnectionPanel({
  clientId,
  connection,
  flashKind,
  flashReason,
}: MetaConnectionPanelProps) {
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleConnect() {
    setErrorMsg(null)
    const result = await getMetaConnectUrlAction(clientId)
    if (result.error || !result.url) {
      setErrorMsg(result.error ?? "Kon de koppeling niet starten.")
      return
    }
    window.location.assign(result.url)
  }

  function handleDisconnect() {
    setErrorMsg(null)
    startTransition(async () => {
      const result = await disconnectMetaAction(clientId)
      if (result.error) {
        setErrorMsg(result.error)
      }
      setConfirming(false)
    })
  }

  const containerStyle: React.CSSProperties = {
    border: "1px solid var(--admin-border)",
    backgroundColor: "var(--admin-surface)",
    borderRadius: "6px",
    padding: "20px 24px",
    marginTop: "24px",
  }
  const headerStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "12px",
  }
  const titleStyle: React.CSSProperties = {
    fontSize: "14px",
    fontWeight: 600,
    color: "var(--admin-text)",
    margin: 0,
  }
  const pillStyle = (connected: boolean): React.CSSProperties => ({
    fontSize: "12px",
    padding: "3px 10px",
    borderRadius: "999px",
    border: `1px solid ${connected ? "var(--admin-border-strong)" : "var(--admin-border)"}`,
    backgroundColor: connected ? "var(--admin-bg)" : "transparent",
    color: connected ? "var(--admin-text)" : "var(--admin-text-subtle)",
  })
  const buttonStyle: React.CSSProperties = {
    padding: "8px 14px",
    fontSize: "13px",
    border: "1px solid var(--admin-border-strong)",
    borderRadius: "4px",
    backgroundColor: "var(--admin-surface)",
    color: "var(--admin-text)",
    cursor: "pointer",
  }
  const dangerStyle: React.CSSProperties = {
    ...buttonStyle,
    color: "var(--admin-sev-critical)",
    borderColor: "var(--admin-sev-critical)",
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h2 style={titleStyle}>Meta connection</h2>
        <span style={pillStyle(connection !== null)}>
          {connection ? "Connected" : "Not connected"}
        </span>
      </div>

      {flashKind === "connected" && (
        <p
          style={{
            color: "var(--admin-text-muted)",
            fontSize: "13px",
            marginTop: 0,
          }}
        >
          Verbonden met Meta. Tokens zijn versleuteld opgeslagen.
        </p>
      )}
      {flashKind === "error" && (
        <p
          style={{
            color: "var(--admin-sev-critical)",
            fontSize: "13px",
            marginTop: 0,
          }}
        >
          {errorReasonText[flashReason ?? ""] ?? "Er ging iets mis bij het koppelen."}
        </p>
      )}
      {errorMsg && (
        <p style={{ color: "var(--admin-sev-critical)", fontSize: "13px" }}>{errorMsg}</p>
      )}

      {connection ? (
        <>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "max-content 1fr",
              columnGap: "16px",
              rowGap: "6px",
              fontSize: "13px",
              color: "var(--admin-text-muted)",
              margin: "8px 0 16px 0",
            }}
          >
            <dt>Facebook Page</dt>
            <dd style={{ color: "var(--admin-text)", margin: 0 }}>
              {connection.pageName}
            </dd>
            <dt>Instagram</dt>
            <dd style={{ color: "var(--admin-text)", margin: 0 }}>
              {connection.instagramBusinessId
                ? `Linked (${connection.instagramBusinessId})`
                : "Not linked"}
            </dd>
            <dt>Connected</dt>
            <dd style={{ color: "var(--admin-text)", margin: 0 }}>
              {connection.connectedAt.toLocaleString("nl-NL")}
            </dd>
          </dl>

          {confirming ? (
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={pending}
                style={dangerStyle}
              >
                {pending ? "Disconnecting..." : "Confirm disconnect"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                style={buttonStyle}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              style={dangerStyle}
            >
              Disconnect Meta
            </button>
          )}
        </>
      ) : (
        <>
          <p
            style={{
              fontSize: "13px",
              color: "var(--admin-text-muted)",
              marginTop: 0,
            }}
          >
            Connect this client&apos;s Facebook Page and linked Instagram Business
            account so the publisher can post on their behalf. You will sign in
            to Facebook with the admin account that manages this Page.
          </p>
          <button type="button" onClick={handleConnect} style={buttonStyle}>
            Connect Instagram / Facebook
          </button>
        </>
      )}
    </div>
  )
}
