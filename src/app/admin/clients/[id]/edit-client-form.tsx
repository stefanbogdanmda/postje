"use client"

import { useState } from "react"
import { updateClient, extractBrandVoiceForClient } from "../actions"
import type { BrandVoiceDraft } from "@/lib/ai/types"

interface EditClientFormProps {
  clientId: string
  email: string
  businessName: string
  location: string | null
  industry: string | null
  businessType: string | null
  productsServices: string | null
  logoUrl: string | null
  toneOfVoice: string | null
  targetCustomers: string | null
  brandPersonality: string | null
  bannedPhrases: string[]
  examplePosts: string[]
  postsPerWeek: number
  hasLoggedIn: boolean
}

export default function EditClientForm({
  clientId,
  email,
  businessName,
  location,
  industry,
  businessType,
  productsServices,
  logoUrl,
  toneOfVoice,
  targetCustomers,
  brandPersonality,
  bannedPhrases,
  examplePosts,
  postsPerWeek,
  hasLoggedIn,
}: EditClientFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Brand-voice fields are controlled so the "Draft from transcript" panel can
  // apply suggestions into them. They still submit via the form's FormData.
  const [tone, setTone] = useState(toneOfVoice ?? "")
  const [target, setTarget] = useState(targetCustomers ?? "")
  const [personality, setPersonality] = useState(brandPersonality ?? "")
  const [banned, setBanned] = useState(bannedPhrases.join("\n"))
  const [examples, setExamples] = useState(examplePosts.join("\n\n"))

  // Transcript-extraction panel
  const [panelOpen, setPanelOpen] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [draft, setDraft] = useState<BrandVoiceDraft | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await updateClient(clientId, formData)

    if (result?.error) {
      setError(result.error)
    }
    setLoading(false)
  }

  async function handleExtract() {
    setExtractError(null)
    setDraft(null)
    setExtracting(true)
    const result = await extractBrandVoiceForClient(clientId, transcript)
    if (result.error) setExtractError(result.error)
    else if (result.draft) setDraft(result.draft)
    setExtracting(false)
  }

  function applyAll(d: BrandVoiceDraft) {
    if (d.toneOfVoice) setTone(d.toneOfVoice)
    if (d.targetCustomers) setTarget(d.targetCustomers)
    if (d.brandPersonality) setPersonality(d.brandPersonality)
    if (d.bannedPhrases.length) setBanned(d.bannedPhrases.join("\n"))
    if (d.examplePosts.length) setExamples(d.examplePosts.join("\n\n"))
  }

  const labelStyle = {
    display: "block" as const,
    fontSize: "13px",
    fontWeight: 500,
    marginBottom: "6px",
    color: "#333",
  }

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #ddd",
    borderRadius: "6px",
    fontSize: "15px",
    boxSizing: "border-box" as const,
  }

  const textareaStyle = {
    ...inputStyle,
    minHeight: "80px",
    resize: "vertical" as const,
    fontFamily: "inherit",
  }

  const hintStyle = {
    color: "#999",
    fontSize: "12px",
    marginTop: "4px",
    marginBottom: 0,
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
        }}
      >
        <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0 }}>
          {businessName}
        </h1>
        <span
          style={{
            color: hasLoggedIn ? "#16a34a" : "#ca8a04",
            fontSize: "13px",
          }}
        >
          {hasLoggedIn ? "Active" : "Invited"}
        </span>
      </div>

      {error && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "6px",
            marginBottom: "20px",
            fontSize: "14px",
            color: "#991b1b",
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="email" style={labelStyle}>
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            disabled
            style={{
              ...inputStyle,
              backgroundColor: "#f9f9f9",
              border: "1px solid #eee",
              color: "#999",
            }}
          />
          <p style={{ color: "#999", fontSize: "12px", marginTop: "4px" }}>
            Email cannot be changed after account creation.
          </p>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="businessName" style={labelStyle}>
            Business Name *
          </label>
          <input
            id="businessName"
            name="businessName"
            type="text"
            required
            defaultValue={businessName}
            style={inputStyle}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          <div>
            <label htmlFor="location" style={labelStyle}>
              Location
            </label>
            <input
              id="location"
              name="location"
              type="text"
              defaultValue={location ?? ""}
              placeholder="Amsterdam"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="industry" style={labelStyle}>
              Industry
            </label>
            <input
              id="industry"
              name="industry"
              type="text"
              defaultValue={industry ?? ""}
              placeholder="Hospitality"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="businessType" style={labelStyle}>
            Business Type
          </label>
          <input
            id="businessType"
            name="businessType"
            type="text"
            defaultValue={businessType ?? ""}
            placeholder="Restaurant"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="productsServices" style={labelStyle}>
            Products / Services
          </label>
          <textarea
            id="productsServices"
            name="productsServices"
            defaultValue={productsServices ?? ""}
            placeholder="Describe what this business offers..."
            style={{
              ...inputStyle,
              minHeight: "80px",
              resize: "vertical" as const,
              fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="postsPerWeek" style={labelStyle}>
            Posts per week
          </label>
          <input
            id="postsPerWeek"
            name="postsPerWeek"
            type="number"
            min={3}
            max={6}
            defaultValue={postsPerWeek}
            style={inputStyle}
          />
          <p style={hintStyle}>
            How many days per week to post (3–6). One post per platform each day.
          </p>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="logoUrl" style={labelStyle}>
            Logo URL
          </label>
          <input
            id="logoUrl"
            name="logoUrl"
            type="url"
            defaultValue={logoUrl ?? ""}
            placeholder="https://..."
            style={inputStyle}
          />
        </div>

        <div
          style={{
            borderTop: "1px solid #eee",
            marginBottom: "28px",
            paddingTop: "20px",
          }}
        >
          <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 4px" }}>
            Brand voice
          </h2>
          <p style={{ color: "#666", fontSize: "12px", margin: "0 0 20px" }}>
            These shape how the AI writes for this client. Leave any field blank
            to fall back to sensible defaults.
          </p>

          {/* Draft-from-transcript onboarding helper */}
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "8px",
              padding: "16px",
              marginBottom: "20px",
              background: "#fafafa",
            }}
          >
            <button
              type="button"
              onClick={() => setPanelOpen((o) => !o)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#333" }}
            >
              {panelOpen ? "▾" : "▸"} Draft from transcript
            </button>

            {panelOpen && (
              <div style={{ marginTop: "14px" }}>
                <p style={{ color: "#666", fontSize: "12px", margin: "0 0 10px" }}>
                  Plak het transcript van het kennismakingsgesprek. We maken een
                  eerste opzet van de merkstem — jij controleert alles voordat je
                  opslaat.
                </p>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="Plak hier het transcript…"
                  style={{ ...textareaStyle, minHeight: "120px" }}
                />
                <button
                  type="button"
                  onClick={handleExtract}
                  disabled={extracting}
                  style={{ marginTop: "10px", padding: "10px 16px", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: 500, cursor: extracting ? "not-allowed" : "pointer", opacity: extracting ? 0.7 : 1 }}
                >
                  {extracting ? "Reading…" : "Extract brand voice"}
                </button>
                {extractError && (
                  <p style={{ color: "#991b1b", fontSize: "13px", marginTop: "10px" }}>{extractError}</p>
                )}

                {draft && (
                  <div style={{ marginTop: "16px" }}>
                    {draft.notes && (
                      <p style={{ fontSize: "12px", color: "#666", fontStyle: "italic", margin: "0 0 12px" }}>
                        {draft.notes}
                      </p>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 600 }}>Suggestions</span>
                      <button
                        type="button"
                        onClick={() => applyAll(draft)}
                        style={{ fontSize: "12px", fontWeight: 600, color: "#1a1a1a", background: "#eee", border: "none", borderRadius: "6px", padding: "6px 12px", cursor: "pointer" }}
                      >
                        Apply all
                      </button>
                    </div>
                    {[
                      { label: "Tone of voice", suggested: draft.toneOfVoice, current: tone, apply: () => setTone(draft.toneOfVoice) },
                      { label: "Target customers", suggested: draft.targetCustomers, current: target, apply: () => setTarget(draft.targetCustomers) },
                      { label: "Brand personality", suggested: draft.brandPersonality, current: personality, apply: () => setPersonality(draft.brandPersonality) },
                      { label: "Banned phrases", suggested: draft.bannedPhrases.join(", "), current: banned.replace(/\n/g, ", "), apply: () => setBanned(draft.bannedPhrases.join("\n")) },
                      { label: "Example posts", suggested: draft.examplePosts.length ? `${draft.examplePosts.length} quote(s) from the call` : "", current: "", apply: () => setExamples(draft.examplePosts.join("\n\n")) },
                    ].map((s) => (
                      <div key={s.label} style={{ border: "1px solid #e5e5e5", borderRadius: "8px", padding: "12px", marginBottom: "8px", background: "#fff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "10px" }}>
                          <span style={{ fontSize: "12px", fontWeight: 600, color: "#333" }}>{s.label}</span>
                          <button
                            type="button"
                            disabled={!s.suggested}
                            onClick={s.apply}
                            style={{ fontSize: "12px", color: s.suggested ? "#1a1a1a" : "#bbb", background: "none", border: "1px solid #ddd", borderRadius: "6px", padding: "4px 10px", cursor: s.suggested ? "pointer" : "not-allowed", flexShrink: 0 }}
                          >
                            Apply
                          </button>
                        </div>
                        <p style={{ fontSize: "13px", color: "#333", margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
                          {s.suggested || <span style={{ color: "#999" }}>— niets uit het transcript —</span>}
                        </p>
                        {s.current && (
                          <p style={{ fontSize: "12px", color: "#666", margin: "4px 0 0" }}>Huidig: {s.current}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label htmlFor="toneOfVoice" style={labelStyle}>
              Tone of voice
            </label>
            <textarea
              id="toneOfVoice"
              name="toneOfVoice"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="Warm, direct, local. No corporate marketing language."
              style={textareaStyle}
            />
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label htmlFor="targetCustomers" style={labelStyle}>
              Target customers
            </label>
            <textarea
              id="targetCustomers"
              name="targetCustomers"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="Who are the customers? One per line or comma-separated."
              style={textareaStyle}
            />
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label htmlFor="brandPersonality" style={labelStyle}>
              Brand personality
            </label>
            <textarea
              id="brandPersonality"
              name="brandPersonality"
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              placeholder="How does the owner come across? e.g. friendly, no-nonsense, playful."
              style={textareaStyle}
            />
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label htmlFor="bannedPhrases" style={labelStyle}>
              Banned phrases
            </label>
            <textarea
              id="bannedPhrases"
              name="bannedPhrases"
              value={banned}
              onChange={(e) => setBanned(e.target.value)}
              placeholder={"One phrase per line\nculinair\ngeniet van"}
              style={textareaStyle}
            />
            <p style={hintStyle}>
              One phrase per line. The AI will never use these.
            </p>
          </div>

          <div style={{ marginBottom: 0 }}>
            <label htmlFor="examplePosts" style={labelStyle}>
              Example posts
            </label>
            <textarea
              id="examplePosts"
              name="examplePosts"
              value={examples}
              onChange={(e) => setExamples(e.target.value)}
              placeholder="Real posts written in the business's own voice. Separate each one with a blank line."
              style={{ ...textareaStyle, minHeight: "120px" }}
            />
            <p style={hintStyle}>
              Separate each example with a blank line. The AI imitates these.
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px 24px",
            backgroundColor: "#1a1a1a",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontSize: "15px",
            fontWeight: 500,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </>
  )
}
