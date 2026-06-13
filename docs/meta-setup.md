# Meta Setup Guide — First Test with Tommy Culinair

This guide walks through everything Postje needs on the Meta side before it can publish to Facebook and Instagram. Our first test subject is **Tommy Culinair**, a real HoReCa business owned by a friend. Using a real client (instead of fake test accounts) is closer to how production will actually work — Tommy will go through the exact OAuth flow that future paying clients go through.

Total time: ~25 focused minutes on your side, plus ~10 minutes Tommy has to spend on his phone. Don't split this across multiple days — Meta's UI is easier to navigate while you've still got the layout in your head.

You'll come out of this with:

- A Facebook **Page** for Tommy Culinair, linked to his existing Business Instagram
- Tommy added as an accepted **tester** on the Postje App
- The Meta App fully configured: products added, OAuth redirect URI whitelisted
- The **App ID** and **App Secret** ready to drop into `.env.local`

The OAuth flow built into Postje (Plan #5a) then handles fetching and encrypting the long-lived Page access token automatically when Tommy clicks **Connect** in the dashboard.

## What's changed (2026-05-14)

Previous versions of this doc walked you through creating fake test accounts (`Café Test Arnhem`). We're skipping that and going straight to a real client. The structure of the doc has shifted to reflect this:

- **Two actors now.** Some steps are Tommy's job; some are yours. Each step is labeled.
- **Three setup steps are already done** (developer account, app shell, your Meta Business Account) — those sections are now short verification checklists, not full walkthroughs.
- **The fake-account creation steps are gone.** If Tommy bails for any reason and we need to fall back to a fake account, ask Claude to restore those steps from git history.
- **Old Step 11 (manual Graph API token fetch)** is renumbered Step 7 and remains optional/educational.

## Who does what

| Done by | Steps |
|---|---|
| **Tommy** | Step 1 (create FB Page), Step 2 (link his IG to it), Step 5 (accept tester invites) |
| **You (Stefan)** | Steps 3, 4, 5a, 5b (App config + sending invites), and the smoke test |

There's a copy-pasteable **"Send this to Tommy"** block at the bottom you can hand him so he knows exactly what's on his plate.

## Vocabulary you'll see

| Term | What it actually is |
|---|---|
| **Personal account / Profile** | The Facebook account a person logs into with their real name. It's the *owner identity* — Pages, Apps, and Business accounts all hang off this. Tommy needs one of these (he has one). |
| **Page** | What businesses post AS on Facebook. Different from a profile. Tommy doesn't have one yet — Step 1 creates it. |
| **Instagram Business account** | An IG account flagged as "professional → Business". Required for API publishing. Tommy already has this. |
| **Meta Business Account** (or "Business Portfolio") | A container that holds Pages, Apps, and ad accounts together. You (Stefan) have one called `Postje`; Tommy doesn't need one. |
| **Meta App** | Your registration with Meta saying "I'm building software that uses the Graph API." Has an App ID and App Secret. You already created this (`Postje Dev`). |
| **Development Mode** | The state your App is in when only people you've explicitly added as testers can authorize it. Free, no review required. We live here until ~10–20 paying clients. |
| **Access token** | The credential we use to make API calls. Three flavors: short-lived user (1h), long-lived user (~60d), and Page token (effectively non-expiring). The OAuth flow does the trading automatically. |
| **Scope / Permission** | A specific thing a token is allowed to do, e.g. `pages_manage_posts` or `instagram_content_publish`. |

## A note on Meta's UI

Meta rearranges the developer console roughly every 6 months. Button labels and menu locations move around. **This guide describes what to *look for*, not exact pixel locations.** If something doesn't match, search the page for the keyword (Ctrl+F), screenshot what you see, and we'll resolve it together when you come back.

---

## ✅ Already done

You've already completed these — confirm each is still true, then skip ahead.

- **Meta Developer account** created at developers.facebook.com.
- **Meta Business Account** (named `Postje`, your operator-side container) created at business.facebook.com.
- **Meta App** (`Postje Dev`) created, type **Business**, in **Development Mode**.

Quick verification: open developers.facebook.com → **My Apps**. You should see `Postje Dev` listed and the header on its dashboard should read **Development**.

---

## Step 1 — Tommy creates a Facebook Page for his business

> **Done by Tommy, 2 min.**

Tommy needs to do this from his personal Facebook account.

1. Log into facebook.com with his personal account.
2. Left sidebar → **Pages** → **Create new Page**.
3. Page name: **Tommy Culinair** (exactly as it should appear publicly).
4. Category: pick the closest fit — for HoReCa, `Restaurant`, `Catering Service`, or `Personal Chef` all work. Pick from the suggestions Meta offers.
5. Click **Create Page**.
6. Skip the optional setup screens (cover photo, address, opening hours) — those can come later.

**Expected outcome:** Tommy is on the new Page's admin view. Its URL contains a number like `facebook.com/profile.php?id=61555...`. That number is the **Page ID** — useful for debugging later. Have Tommy copy it and send it to you.

**If Tommy doesn't have a personal Facebook account:** he needs one. Facebook Pages can only be managed by personal accounts — there's no workaround. Creating a personal account is free and takes a few minutes.

---

## Step 2 — Tommy links his Business Instagram to the new Page

> **Done by Tommy, 5 min.** This is the step people most often get wrong. **Both the link AND the Business status matter.** A Business IG with no Page link is invisible to the Graph API.

Easiest from the Instagram mobile app:

1. Open Instagram → his Tommy Culinair business profile.
2. **Settings and privacy** → **Account type and tools**. Confirm it says **Business** (not Creator, not Personal). If it doesn't, switch it.
3. **Settings and privacy** → **Account Center** → **Connected experiences** → **Connect a Facebook account**. Log into his personal FB when prompted.
4. Back in IG: **Edit profile** → scroll to **Page** → pick **Tommy Culinair**.

**Expected outcome:** When Tommy opens **Edit profile** on his IG, the field labeled **Page** reads `Tommy Culinair`. Ask him to screenshot that screen and send it to you — that's your proof the link took.

If that line is empty or shows a different Page, the link didn't stick. Most common cause: the IG account is on **Creator** not **Business**, or his personal FB and the Page belong to different accounts.

---

## Step 3 — You verify the App has the right products

> **Done by you, 3 min.**

1. Go to developers.facebook.com → **My Apps** → open your `SocialAi` app (or whatever you named it — App ID is the one you wrote down when you created it).
2. You'll land on the **Dashboard**. You're already "inside" the app — no separate open step needed.
3. Scroll down to **Add products to your app** (or click **Add Product** in the left sidebar). At the bottom of that section there's a **My products** subsection showing what's already added.

Required products (the modern, post-2024 list — Meta has consolidated these):

- **Facebook Login for Business** — includes everything the old standalone "Pages API" product used to unlock (`pages_show_list`, `pages_manage_posts`, `pages_manage_metadata`, etc.)
- **Instagram** — when adding, pick **Instagram Graph API** if it asks

> **Note:** Older guides mention "Pages API" as a third product to add. It no longer exists as a separate tile in the Meta dev console — the permissions moved into Facebook Login for Business. If you can't find it, you're not missing anything; just confirm both products above are in your **My products** list.

For each missing one: click **Set up** on its tile, leave defaults, click through the confirmation screen.

**Expected outcome:** Both products appear under **My products**.

---

## Step 4 — Configure the OAuth redirect URI

> **Done by you, 2 min.**

This is the address Meta sends users back to after they grant access to your App. Postje's OAuth callback lives at `/api/meta/callback`. Without whitelisting it here, the Connect button inside Postje fails with a "URL Blocked" error.

1. App Dashboard sidebar → **Products** → **Facebook Login for Business** → **Settings** (sometimes labeled **Configuration**).
2. Find the **Valid OAuth Redirect URIs** field.
3. Paste these two URLs, one per line:
   - `http://localhost:3000/api/meta/callback` — for local dev
   - `https://<your-production-domain>/api/meta/callback` — for production (leave off until you have a real domain)
4. Save.

**Expected outcome:** Both URLs appear in the field. When Tommy clicks Connect inside Postje, Meta will redirect him to one of these — anything else gets blocked.

---

## Step 5 — Add Tommy as a tester

> **Started by you, finished by Tommy. ~5 min wall-clock.**

In Development Mode, only people you've explicitly added as testers can authorize the App. Tommy needs **two** kinds of access:

- **App-level tester** — so he can authorize the App in Dev Mode
- **Instagram tester** — so his IG account is reachable by the Instagram Graph API

Both invites need to be sent by you, and both have to be **accepted by Tommy** before anything works.

### 5a. Add Tommy as an App tester (you)

1. App Dashboard sidebar → **App Roles** → **Roles**.
2. Click **Add People** → choose **Tester**.
3. Enter Tommy's name or Facebook URL (you can search by name — he has to be findable on Facebook, which he is, since he just created a Page from his personal account).
4. Send invite.

### 5b. Add Tommy's IG as an Instagram tester (you)

1. Sidebar → **Products** → **Instagram** → look for a screen labeled **API setup**, **Instagram testers**, or **Roles** (Meta's been renaming this one).
2. Find **Add or remove Instagram testers**.
3. Enter Tommy's IG handle (get the exact handle from him — case-insensitive but no `@`).
4. Send invite.

### 5c. Tommy accepts both invites (Tommy)

Two notifications, two accept actions:

- **Facebook tester invite:** Tommy opens his Facebook notifications, sees the invitation from Postje Dev, clicks **Accept**.
- **Instagram tester invite:** Tommy logs into the Tommy Culinair Instagram → Settings → **Apps and websites** → **Tester invites** → **Accept**.

**Expected outcome:** Back on your side, the App Roles screen shows Tommy as an **Accepted** tester (not "Pending"), and the Instagram testers list shows his handle as Accepted too. If either says Pending, Tommy hasn't clicked through yet.

---

## What you walk away with — the required set

After Step 5 is fully accepted, you have everything Postje needs:

| Variable | Example | Where to find |
|---|---|---|
| `META_APP_ID` | `123456789012345` | App Dashboard → Settings → Basic |
| `META_APP_SECRET` | `abc123...` | Same screen. Hidden behind a "Show" button — enter your password to reveal. |

Plus, configured *inside* the Meta App itself (not values you copy):

- Tommy Culinair Page + his Business IG linked to it
- OAuth redirect URI `http://localhost:3000/api/meta/callback` whitelisted
- Tommy accepted as both an App tester and an Instagram tester

⚠️ **Do not paste your App Secret anywhere it could be saved publicly.** Not in chat, not in commits, not in shared notes. It goes in `.env.local`, which is gitignored.

Add the values to `.env.local`:

```
META_APP_ID=<your-app-id>
META_APP_SECRET=<your-app-secret>
META_OAUTH_REDIRECT_URI=http://localhost:3000/api/meta/callback
META_TOKEN_ENCRYPTION_KEY=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
META_GRAPH_VERSION=v21.0
```

---

## Optional but recommended — Set yourself up for dry runs

> **Done by you, ~5 min.** Strongly recommended before you involve Tommy.

The goal here is to catch bugs in *your* code without burning Tommy's patience. You'll click **Connect** against a Page you own, hit any errors, fix them, repeat — and only call Tommy once the flow works clean.

What you need:

- Your own personal Facebook account ✅ (you have this)
- A **throwaway Facebook Page** you create just for testing — name it whatever, `Stefan Test Page` is fine. Delete it later if you want.
- Optional: a throwaway Instagram Business account linked to that Page, only if you want to verify the IG side too. If you skip this, the dry run only covers the Facebook half of the flow — the OAuth handshake, token exchange, encryption, and DB write. That's already 80% of what can break.

Setup:

1. **Create the throwaway Page** — same as Step 1, but on your own personal FB account. Name + category don't matter. Skip all the optional setup screens.
2. **Add yourself as an App tester** — same as Step 5a, but enter your own name. Accept the invite on your Facebook notifications.
3. *(Optional IG side)* If you want to test IG too: create a fresh IG account using the Gmail `+` trick (`admin+dryrun@example.com` lands in your real inbox but counts as new everywhere else), switch it to Business, link it to your throwaway Page. Then add it as an Instagram tester (Step 5b) and accept.

Now run the smoke test below using your own credentials first. When it works end to end on your throwaway Page, you know the code is solid — repeat with Tommy.

---

## Smoke test — does the full flow work end to end?

Two ways to run this. The "dry run" version uses your own throwaway Page (set up above). The "real test" version uses Tommy's account. Do the dry run first.

For either version:

1. `npm run dev`
2. Sign in as admin on Postje.
3. Create a client row in the admin UI for whoever you're testing with — yourself for the dry run, Tommy for the real test. Go to `/admin/clients/<that-client-id>`.
4. Click **Connect Instagram / Facebook**.
5. You'll be redirected to Meta. **You need to be logged into Facebook as the account that owns the target Page.** For the dry run that's you; for the real test that's Tommy (easiest: have him do it on his phone with screen-share).
6. Approve the Meta consent dialog. Pick the correct Page when asked — your throwaway Page for the dry run, **Tommy Culinair** for the real test.
7. Meta redirects back to Postje. The panel should flip to **Connected**, showing the Page name and Instagram ID.
8. In Drizzle Studio, open the `meta_connections` table. There should be a new row tied to the right `client_id`, with an encrypted `access_token` (gibberish, not plaintext) and the Page/IG IDs visible.

If anything fails, **screenshot the error before clicking away**. Meta errors are cryptic but specific — wrong fixes waste hours.

---

## Step 6 — Optional: manual token fetch via Graph API Explorer

> **Skip this on your first time through.** Postje's OAuth flow (Plan #5a) does all of this automatically. This step is kept for two reasons: (a) it explains what the OAuth flow is doing under the hood, useful when you debug Meta errors; (b) if you ever need to hit the Graph API directly without running Postje, the manual token is how.

### 6a. Open the Graph API Explorer

1. Go to developers.facebook.com/tools/explorer.
2. Top right: set **Meta App** to `Postje Dev`.
3. Set **User or Page** to **User Token**.
4. Click **Add a Permission** and add all of these:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `pages_manage_metadata`
   - `business_management`
   - `instagram_basic`
   - `instagram_content_publish`
5. Click **Generate Access Token**. Meta will pop up a permission dialog — accept everything, picking the Tommy Culinair Page when asked.
6. Copy the token. **This is a short-lived (1-hour) user token.** Save it to a scratchpad — we'll trade it for a long-lived one in a moment.

### 6b. Confirm the token sees the Page

In the Graph API Explorer, with that token active:

1. In the query field, type: `me/accounts`
2. Click **Submit**.

You should see JSON listing Pages. Find the Tommy Culinair entry and copy its `access_token` and `id`. **That `access_token` is a Page Access Token — what we actually want to store.** A Page Access Token derived from a long-lived user token is effectively non-expiring.

But the user token is currently short-lived, so the derived Page token is also short-lived. We need to extend the user token first.

### 6c. Extend the user token to long-lived (60 days)

Find **App ID** and **App Secret** in App Dashboard → Settings → Basic. The Secret is hidden — click **Show**, enter your password.

In a browser tab, visit (with placeholders replaced):

```
https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=YOUR_SHORT_LIVED_USER_TOKEN
```

The response is JSON with `access_token` and `expires_in`. `expires_in` should be ~5,184,000 seconds = 60 days. **This is your long-lived user token.** Save it.

### 6d. Re-derive the Page token from the long-lived user token

Back in the Graph API Explorer:

1. Paste the long-lived user token from 6c into the **Access Token** field.
2. Run `me/accounts` again.
3. Copy the `access_token` from the Tommy Culinair entry. **This is your long-lived Page Access Token.** Save it.

### 6e. Find the linked Instagram Business Account ID

Still in the Explorer:

1. Find Tommy's Page ID (from Step 1, or the `id` field in `me/accounts`).
2. Run: `YOUR_PAGE_ID?fields=instagram_business_account`
3. Response:
   ```json
   {
     "instagram_business_account": { "id": "17841..." },
     "id": "YOUR_PAGE_ID"
   }
   ```
4. Save `instagram_business_account.id` — **this is the Instagram Business Account ID** we POST IG content to.

If `instagram_business_account` is missing from the response: Tommy's IG isn't properly linked to the Page (back to Step 2). Most common cause: IG is still **Creator** instead of **Business**, or the personal FB used in IG's Account Center is different from the one that owns the Page.

---

## Optional sanity check — only if you did Step 6

With a Page Access Token in hand, verify it works in the Graph API Explorer:

1. `me?fields=name` → should return `"Tommy Culinair"`
2. `me?fields=instagram_business_account` → should return the IG ID
3. `me/feed?fields=id&limit=1` → should return `{"data":[]}` (no posts yet) — proves the token can read the Page's feed

If anything errors, **screenshot the error** — most Meta errors are cryptic but specific, and the wrong fix wastes hours.

---

## Send this to Tommy

Copy-paste the block below to Tommy (translate to Dutch as needed — your call on tone). It tells him exactly what's on his plate, in order.

> Hé Tommy — voor het testen van Postje met jouw zaak heb ik drie kleine dingen van je nodig. Samen ongeveer 10 minuten, allemaal op je telefoon.
>
> **1) Maak een Facebook Page voor Tommy Culinair**
> Op facebook.com → linker zijbalk → **Pages** → **Create new Page**. Naam: "Tommy Culinair". Categorie: kies wat het dichtst bij je werk ligt (Restaurant, Catering, Personal Chef). Klik op Create. De rest (foto, adres, openingstijden) kun je later doen. Stuur me daarna de link naar de Page.
>
> **2) Koppel je Instagram-account aan die Page**
> Open Instagram-app → jouw Tommy Culinair profiel → **Instellingen en privacy** → **Accounttype en tools** → check dat het op **Business** staat (niet Creator). Dan: **Bewerk profiel** → onderaan zie je **Page** — kies "Tommy Culinair". Maak een screenshot van dat scherm en stuur 'm naar mij.
>
> **3) Accepteer de twee uitnodigingen die ik je stuur**
> Je krijgt straks twee uitnodigingen om "tester" te worden voor de Postje app:
> - Eén op Facebook (notificatie) — gewoon op **Accepteer** klikken.
> - Eén op Instagram — in IG-app: **Instellingen** → **Apps en websites** → **Tester-uitnodigingen** → accepteer.
>
> Klaar. Daarna kan ik aan de gang met de eerste echte posts voor je zaak.

---

Welcome to the world of social media APIs. It's not always like this, but the first time it always is.
