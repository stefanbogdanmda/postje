import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Algemene Voorwaarden — Postje",
  description: "Voorwaarden voor het gebruik van Postje",
}

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 font-sans text-[var(--text-primary)]">
      <h1 className="mb-2 font-[family-name:var(--font-display)] text-3xl">
        Algemene Voorwaarden
      </h1>
      <p className="mb-10 text-sm text-[var(--text-secondary)]">
        Laatst bijgewerkt: 20 mei 2026
      </p>

      <section className="space-y-6 text-[15px] leading-relaxed">
        <div>
          <h2 className="mb-2 text-lg font-semibold">1. Wat is Postje?</h2>
          <p>
            Postje is een dienst die social media content maakt en publiceert
            voor kleine ondernemers. Wij genereren berichten voor je
            Instagram- en Facebook-accounts. Jij beoordeelt elk bericht
            (goedkeuren of afwijzen) voordat het wordt geplaatst.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">2. Hoe werkt het?</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Wij maken een account voor je aan na een kennismakingsgesprek
            </li>
            <li>
              Wij verbinden je Facebook- en/of Instagram-account via een
              beveiligde koppeling (OAuth)
            </li>
            <li>
              Wij genereren wekelijks berichten op basis van je merkprofiel
            </li>
            <li>
              Jij keurt elk bericht individueel goed of af via je dashboard
            </li>
            <li>Goedgekeurde berichten worden automatisch gepubliceerd</li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">3. Jouw account</h2>
          <p>
            Je logt in met een magic link die naar je e-mailadres wordt
            gestuurd. Er zijn geen wachtwoorden. Je bent verantwoordelijk voor
            de toegang tot je e-mailadres. Als je vermoedt dat iemand anders
            toegang heeft tot je account, neem dan direct contact met ons op.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">
            4. Wat wij wel en niet doen
          </h2>
          <p className="mb-2">
            <strong>Wij doen:</strong>
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Content genereren die past bij jouw merk en doelgroep</li>
            <li>Berichten publiceren die jij hebt goedgekeurd</li>
            <li>Je social media tokens veilig en versleuteld bewaren</li>
            <li>
              Je op de hoogte houden via e-mail als er berichten klaarstaan
            </li>
          </ul>
          <p className="mb-2 mt-4">
            <strong>Wij doen niet:</strong>
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Berichten plaatsen zonder jouw expliciete goedkeuring
            </li>
            <li>Je gegevens verkopen aan derden</li>
            <li>Garantie geven op specifieke resultaten (volgers, bereik)</li>
            <li>
              Verantwoordelijkheid nemen voor de inhoud nadat jij het hebt
              goedgekeurd — jij bent eindverantwoordelijk voor wat er op jouw
              accounts verschijnt
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">5. Kosten</h2>
          <p>
            Postje werkt met een maandelijks abonnement. De actuele prijzen
            worden besproken tijdens het kennismakingsgesprek. Eventuele
            eenmalige opstartkosten worden vooraf gecommuniceerd.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">6. Opzegging</h2>
          <p>
            Je kunt je abonnement op elk moment opzeggen. Na opzegging:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Wij stoppen met het genereren en publiceren van berichten
            </li>
            <li>Je kunt je gegevens laten verwijderen (zie privacybeleid)</li>
            <li>
              Reeds gepubliceerde berichten blijven staan op je social media —
              die beheer je zelf
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">
            7. Aansprakelijkheid
          </h2>
          <p>
            Postje doet zijn best om een betrouwbare dienst te leveren, maar
            kan niet garanderen dat de dienst altijd beschikbaar of foutloos
            is. Wij zijn niet aansprakelijk voor:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Storingen bij Meta (Facebook/Instagram) die publicatie
              verhinderen
            </li>
            <li>Gederfde inkomsten door het niet plaatsen van berichten</li>
            <li>
              Inhoud die door jou is goedgekeurd maar achteraf ongewenst
              blijkt
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">8. Privacy</h2>
          <p>
            Wij gaan zorgvuldig om met je gegevens. Lees ons{" "}
            <a
              href="/privacy"
              className="text-[var(--accent-edit)] underline underline-offset-2"
            >
              privacybeleid
            </a>{" "}
            voor alle details.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">9. Wijzigingen</h2>
          <p>
            Wij kunnen deze voorwaarden aanpassen. Bij belangrijke
            wijzigingen informeren wij je per e-mail. Door de dienst te
            blijven gebruiken na een wijziging, ga je akkoord met de
            aangepaste voorwaarden.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">10. Contact</h2>
          <p>
            Vragen over deze voorwaarden? Stuur een e-mail naar{" "}
            <a
              href="mailto:info@postje.nl"
              className="text-[var(--accent-edit)] underline underline-offset-2"
            >
              info@postje.nl
            </a>
          </p>
        </div>

        <div className="border-t border-[var(--border-light)] pt-6 text-sm text-[var(--text-muted)]">
          <p>
            Op deze voorwaarden is Nederlands recht van toepassing.
          </p>
        </div>
      </section>
    </main>
  )
}
