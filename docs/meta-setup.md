# Meta Setup Guide — Test Accounts for Social AI

This guide walks you through creating the Meta-side accounts that Social AI needs before it can publish to Facebook and Instagram. Everything in this guide is free. Total time: 30–45 focused minutes. Don't split it across multiple days — Meta's interface is much harder to navigate if you keep losing your place.

You'll come out of this with:

- A test Facebook **Page**
- A test Instagram **Business** account linked to that Page
- A **Meta Developer account** + a registered **Meta App** in Development Mode
- A **long-lived access token** that can post to both

These four things are the keys that let our code talk to Meta. Without them, the cron job we're about to build has nothing to send.

## Vocabulary You'll See

| Term | What it actually is |
|---|---|
| **Personal account / Profile** | The Facebook account you log into with your name. It's the *owner identity* — Pages, Apps, and Business accounts all hang off this. |
| **Page** | What businesses post AS. Different from a profile. You can own many. |
| **Instagram Business account** | An IG account flagged as "professional". Required for API publishing. Personal IG accounts cannot be posted to programmatically — Meta blocks this. |
| **Meta Business Account** (or "Business Portfolio") | A container that holds your Pages, Apps, and ad accounts together. Confusingly different from the Page itself. You probably don't have one yet — you'll create one. |
| **Meta App** | Your registration with Meta saying "I'm building software that will use the Graph API." Has an App ID and App Secret. |
| **Development Mode** | The state your App is in when it's only usable by people you've explicitly added as testers. Free, no review required. We live here until you have ~10–20 paying clients. |
| **Access token** | The credential we use to make API calls. Comes in three flavors: short-lived user (1 hour), long-lived user (~60 days), and Page token (essentially permanent, what we actually store). |
| **Scope / Permission** | A specific thing a token is allowed to do, e.g. `pages_manage_posts` or `instagram_content_publish`. |

## A Note On Meta's UI

Meta rearranges the developer console roughly every 6 months. Button labels, menu locations, and even the names of products move around. **This guide describes what to *look for*, not exact pixel locations.** If something doesn't match, search the page for the keyword (Ctrl+F your friend), and screenshot what you see — we'll resolve it together when you come back.

A test business identity will make this easier. Pick a fake-but-believable Dutch business name and use it consistently. For this guide I'll use **"Café Test Arnhem"** as the placeholder — substitute your own.

---

## Step 1 — Create the test Facebook Page (2 min)

1. Log into facebook.com with your personal account.
2. In the left sidebar, click **Pages** (if you don't see it, click "See more" first).
3. Click **Create new Page**.
4. Page name: `Café Test Arnhem` (or your pick).
5. Category: `Café` — start typing and pick one of the suggestions.
6. Click **Create Page**.
7. Skip every optional setup step (cover photo, etc.). We don't need a real-looking Page.

**Expected outcome:** You're on the new Page's admin view. Note its URL — it'll have a number in it like `facebook.com/profile.php?id=61555...`. That number is the **Page ID**. Save it somewhere (we'll need it later).

## Step 2 — Create the Instagram account (5 min)

You'll need a fresh email address. Trick: Gmail ignores everything after a `+` in addresses, so `stefanbogdanmda+sotest@gmail.com` lands in your real inbox but counts as a "new" email everywhere else. Use this.

1. Go to instagram.com and click **Sign up**.
2. Use the `+`-trick email.
3. Pick a unique handle — `cafe_test_arnhem` or similar. Doesn't need to be pretty.
4. Use any password (save it in a password manager).
5. Confirm the verification email Instagram sends.

**Expected outcome:** You're logged into a brand-new Instagram personal account. It currently has 0 posts and 0 followers — that's fine.

## Step 3 — Convert the Instagram account to Business + link to the Page (5 min)

This is the step people most often get wrong. **Both the conversion AND the linking matter.** A converted-but-unlinked Business account is invisible to the Graph API.

You can do this either on the IG mobile app or instagram.com. Mobile is more reliable.

1. On the new IG account, go to **Settings and privacy** → **Account type and tools** → **Switch to professional account**.
2. Pick a category — `Café` works. Confirm.
3. Choose **Business** (not Creator). Continue.
4. When IG asks "Are you a business or creator?" — pick **Business**.
5. **Critical step:** IG will ask you to **connect a Facebook Page**. Connect the `Café Test Arnhem` Page you created in Step 1. Log into your personal FB if prompted.

If IG doesn't prompt for Page linking automatically: go to Settings → Account Center → Connected experiences → **Connect a Facebook account**, link your personal FB, then back in IG go to **Edit profile** → **Page** → pick the Café Test Arnhem Page.

**Expected outcome:** In your IG profile's "Edit profile" view, you should see "Page: Café Test Arnhem" listed. If you don't, the link didn't take — try again. The publishing pipeline literally cannot find your IG account otherwise.

## Step 4 — Create a Meta Business Account (3 min)

Skip this step if you somehow already have one. Otherwise:

1. Go to **business.facebook.com**.
2. Click **Create account**.
3. Business name: `Social AI` (this is yours, the operator, not the test café).
4. Your name + work email (your real email is fine here).
5. Confirm via email.

**Expected outcome:** You're in the Meta Business Suite for Social AI. This is a *container* — it'll hold your Pages and Apps. You haven't added anything to it yet.

## Step 5 — Add the test Page to the Business Account (2 min)

1. In Business Suite, find **Business Settings** (cog icon, usually bottom-left).
2. Go to **Accounts** → **Pages**.
3. Click **Add** → **Add a Page**.
4. Search for or paste the link to your Café Test Arnhem Page. Add it.
5. Meta may ask you to confirm ownership via your personal FB — do that.

**Expected outcome:** The Café Test Arnhem Page now appears in Business Settings → Accounts → Pages.

## Step 6 — Create the Meta Developer account (3 min)

1. Go to **developers.facebook.com**.
2. Click **Get Started** in the top right.
3. Accept the developer terms.
4. Confirm via SMS or email.

**Expected outcome:** You can now access **My Apps** in the top-right menu.

## Step 7 — Create the Meta App (5 min)

1. **My Apps** → **Create App**.
2. App type: pick **Business**. (Other types won't give you Instagram Content Publishing — this is the one we need.)
3. App name: `Social AI Dev`.
4. App contact email: your real email.
5. Business Account: select the `Social AI` Business Account you made in Step 4.
6. Click **Create App** — Meta will ask for your FB password as confirmation.

**Expected outcome:** You're now in the App Dashboard for Social AI Dev. The header shows the App is in **Development** mode. Note the **App ID** somewhere — we'll need it.

## Step 8 — Add the Graph API products (5 min)

In the App Dashboard, look for a **Products** section in the left sidebar, or a "+ Add Product" button. Add these products one at a time:

1. **Facebook Login for Business** — leave default settings.
2. **Pages API** — leave default settings.
3. **Instagram** — when adding, pick "Instagram Graph API" if asked. Leave default settings.

For each one, after adding, Meta will drop you in its config page. You don't need to configure anything — just click around to confirm it was added.

**Expected outcome:** All three products show up in the left sidebar under **Products**.

## Step 9 — Add yourself as an Instagram tester (2 min)

This is the step that lets your real personal FB account act on the test setup while the App is in Development Mode.

1. In the App Dashboard left sidebar, find **App Roles** → **Roles**.
2. Add your personal account as an **Administrator** (it probably already is, since you created the App).
3. Then go to **Products** → **Instagram** → **API setup with Instagram Login** (or similar).
4. There should be a section called **Add or remove Instagram testers**. Add your test IG account (`cafe_test_arnhem`) as a tester.
5. **Accept the invitation:** log into the test IG account, go to Settings → Apps and Websites → **Tester Invites**, accept.

**Expected outcome:** The test IG account is now an accepted tester on the App.

## Step 10 — Get a long-lived access token (10 min)

This is the longest step. Read it through once before doing it.

### 10a. Open the Graph API Explorer

1. Go to **developers.facebook.com/tools/explorer**.
2. In the top right, set **Meta App** to `Social AI Dev`.
3. Set **User or Page** to **User Token**.
4. Click **Add a Permission** and add all of these (you'll need to click through several categories):
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `pages_manage_metadata`
   - `business_management`
   - `instagram_basic`
   - `instagram_content_publish`
5. Click **Generate Access Token**. Meta will pop up a permission dialog — accept everything, picking the Café Test Arnhem Page when asked which Page to grant access to.
6. Copy the token that appears. **This is a short-lived (1-hour) user token.** Save it to a scratchpad — we'll trade it in for a long-lived one in a moment.

### 10b. Confirm the token sees the Page

In the Graph API Explorer, with that token still active:

1. In the query field, type: `me/accounts`
2. Click **Submit**.

You should see a JSON response listing your Pages. Find the Café Test Arnhem entry and copy its `access_token` and `id` values. **That `access_token` is a Page Access Token — it's what we actually want to store.** A Page Access Token derived from a long-lived user token is effectively non-expiring.

But wait — the user token is currently short-lived, so the Page token derived from it is also short-lived. We need to extend the user token first. Don't skip this.

### 10c. Extend the user token to long-lived (60 days)

You'll need your **App ID** and **App Secret**. Find both at:

`App Dashboard → App Settings → Basic`

The App Secret is hidden behind a "Show" button — click it, enter your password.

⚠️ **Do not paste your App Secret anywhere it could be saved publicly.** Not in chat, not in a commit, not in a public note. We'll move it to environment variables when we build the code.

Open a new browser tab and visit this URL (with the three placeholders replaced):

```
https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=YOUR_SHORT_LIVED_USER_TOKEN
```

The response is JSON with `access_token` and `expires_in`. The `expires_in` should be roughly 5,184,000 seconds = 60 days. **This is your long-lived user token.** Save it.

### 10d. Re-derive the Page token from the long-lived user token

Back in the Graph API Explorer:

1. In the **Access Token** field at the top, paste the long-lived user token from 10c.
2. Run `me/accounts` again.
3. Copy the `access_token` from the Café Test Arnhem entry. **This is your long-lived Page Access Token.** Save it.

### 10e. Find the linked Instagram Business Account ID

Still in the Explorer, with the Page token from 10d (or still on the user token):

1. Find your Page ID (from Step 1, or from the `id` field of the `me/accounts` response).
2. Run: `YOUR_PAGE_ID?fields=instagram_business_account`
3. Response will be:
   ```json
   {
     "instagram_business_account": { "id": "17841..." },
     "id": "YOUR_PAGE_ID"
   }
   ```
4. Save the `instagram_business_account.id` value. **This is your Instagram Business Account ID** — the thing we POST IG content to.

If `instagram_business_account` is missing from the response: your IG account isn't properly linked to the Page (back to Step 3). The most common cause is that the IG account is still "Personal" or "Creator" type instead of "Business".

## What you walk away with

A scratchpad containing:

| Variable | Example | What it is |
|---|---|---|
| `META_APP_ID` | `123456789012345` | Your Meta App's ID |
| `META_APP_SECRET` | `abc123...` | Your Meta App's Secret (keep private) |
| `META_TEST_PAGE_ID` | `61555...` | Café Test Arnhem's Page ID |
| `META_TEST_PAGE_TOKEN` | `EAA...` (very long) | Long-lived Page Access Token |
| `META_TEST_IG_USER_ID` | `17841...` | The linked Instagram Business Account ID |

We'll wire these into `.env.local` as your "default test client" during development. Real clients will go through an OAuth flow that produces the same set of values per client.

## Sanity check before coming back

Run these three queries in the Graph API Explorer using `META_TEST_PAGE_TOKEN`:

1. `me?fields=name` → should return `"Café Test Arnhem"`
2. `me?fields=instagram_business_account` → should return the IG ID
3. `me/feed?fields=id&limit=1` → should return `{"data":[]}` (no posts yet) — proves the token can read the Page's feed

If all three return without errors, you're done. Come back and we'll resume the brainstorm.

If anything errors or doesn't match, **screenshot the error and paste it into the chat** — we'll fix it before moving on. Don't try to power through; Meta's errors are cryptic but specific, and the wrong fix wastes hours later.

Welcome to the world of social media APIs. It's not always like this, but the first time it always is.
