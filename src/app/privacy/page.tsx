import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacybeleid — Postje",
  description: "Hoe Postje omgaat met jouw gegevens",
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 font-sans text-[var(--text-primary)]">
      <h1 className="mb-2 font-[family-name:var(--font-display)] text-3xl">
        Privacybeleid
      </h1>
      <p className="mb-10 text-sm text-[var(--text-secondary)]">
        Laatst bijgewerkt: 20 mei 2026
      </p>

      <section className="space-y-6 text-[15px] leading-relaxed">
        <div>
          <h2 className="mb-2 text-lg font-semibold">Wie zijn wij?</h2>
          <p>
            Postje is een dienst die social media beheert voor kleine
            ondernemers. Wij maken berichten voor jouw Instagram- en
            Facebook-accounts, en publiceren ze nadat jij ze hebt goedgekeurd.
            Postje is gevestigd in Nederland.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">
            Welke gegevens verzamelen wij?
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Accountgegevens</strong> — je naam, e-mailadres en
              bedrijfsnaam. Nodig om je account aan te maken en in te loggen.
            </li>
            <li>
              <strong>Merkprofiel</strong> — informatie over je bedrijf
              (branche, doelgroep, tone of voice). Hiermee maken wij berichten
              die bij je passen.
            </li>
            <li>
              <strong>Social media tokens</strong> — toegangstokens van Meta
              (Facebook/Instagram). Deze worden versleuteld opgeslagen en
              alleen gebruikt om berichten te publiceren namens jou.
            </li>
            <li>
              <strong>Berichten en foto&apos;s</strong> — de content die wij
              voor je genereren en die jij goedkeurt of afwijst.
            </li>
            <li>
              <strong>Gebruiksgegevens</strong> — wanneer je inlogt, berichten
              beoordeelt en feedback geeft. Geen tracking cookies, geen
              analytics van derden.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">
            Waarom verzamelen wij deze gegevens?
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Om social media berichten te genereren en te publiceren</li>
            <li>Om je account te beheren en je te laten inloggen</li>
            <li>Om de kwaliteit van onze service te verbeteren</li>
            <li>Om je te informeren over je berichten (e-mailnotificaties)</li>
          </ul>
          <p className="mt-2">
            Wij verkopen je gegevens niet aan derden. Wij delen je gegevens
            alleen met Meta (Facebook/Instagram) om berichten te publiceren,
            en met onze e-maildienst (Resend) om je notificaties te sturen.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">
            Hoe lang bewaren wij je gegevens?
          </h2>
          <p>
            Wij bewaren je gegevens zolang je account actief is. Wanneer je
            je account verwijdert, worden al je gegevens binnen 30 dagen
            definitief verwijderd, inclusief berichten, foto&apos;s,
            merkprofiel en toegangstokens.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">
            Beveiliging
          </h2>
          <p>
            Toegangstokens van Meta worden versleuteld opgeslagen
            (AES-256-GCM). Wij gebruiken beveiligde verbindingen (HTTPS) en
            magic link-authenticatie (geen wachtwoorden). Sessies verlopen
            automatisch na 30 dagen.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">Jouw rechten</h2>
          <p>
            Onder de AVG (GDPR) heb je het recht om:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Je gegevens in te zien</li>
            <li>Je gegevens te laten corrigeren</li>
            <li>Je gegevens te laten verwijderen</li>
            <li>Je gegevens te exporteren (dataportabiliteit)</li>
            <li>Bezwaar te maken tegen verwerking</li>
          </ul>
          <p className="mt-2">
            Neem contact op via het e-mailadres hieronder om een van deze
            rechten uit te oefenen.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">
            Gegevens verwijderen via Meta
          </h2>
          <p>
            Als je via Facebook of Instagram je gegevens bij Postje wilt
            verwijderen, kun je dat doen via de instellingen van je
            Meta-account. Wij ontvangen dan automatisch een verzoek en
            verwijderen je gegevens binnen 30 dagen. Je kunt de status
            opvragen met het bevestigingsnummer dat je ontvangt.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">Contact</h2>
          <p>
            Vragen over je privacy of je gegevens? Stuur een e-mail naar{" "}
            <a
              href="mailto:privacy@postje.nl"
              className="text-[var(--accent-edit)] underline underline-offset-2"
            >
              privacy@postje.nl
            </a>
          </p>
        </div>

        <div className="border-t border-[var(--border-light)] pt-6 text-sm text-[var(--text-muted)]">
          <p>
            Dit privacybeleid kan worden aangepast. Wijzigingen worden op
            deze pagina gepubliceerd met een nieuwe datum.
          </p>
        </div>
      </section>
    </main>
  )
}
