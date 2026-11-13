# Gmail Today: connecting your Gmail

Gmail Today runs on Vercel. A small sign-in server (`/api`) keeps you signed in on each device for up to about a year, the way the Gmail app does, and only lets **one Google account** in (set by `ALLOWED_EMAIL`). Your mail stays in Gmail, and nothing is stored on the server.

**Your app address:** `https://gmail-today.vercel.app`

## 1. Create your Google sign-in key (about 10 minutes, one time)

1. Go to https://console.cloud.google.com/ and create a project called **gmail-today**.
2. Open **APIs & Services → Library**, search for **Gmail API**, and click **Enable**.
3. Open **Google Auth Platform → Branding** (older consoles call it "OAuth consent screen").
   - App name: **My Today Mail**. Google does not allow its own names (like "Gmail") on this screen. Support email: your Gmail.
   - Authorised domains: leave empty (not needed for a personal app).
4. **Audience:** choose **External**, then click **Publish app** so the status says **In production**.
   - Why: in "Testing" mode Google signs you out every 7 days. "In production" keeps you signed in.
   - You do **not** need to submit the app for Google's verification. Google will show an "unverified app" warning when you sign in: click **Advanced → Go to My Today Mail**. That's normal for a personal app.
5. **Data access → Add or remove scopes:** add `https://www.googleapis.com/auth/gmail.modify` (plus `openid` and `email`).
6. **Clients → Create client:**
   - Type: **Web application**
   - Authorised JavaScript origins: `https://gmail-today.vercel.app`
   - Authorised redirect URIs: `https://gmail-today.vercel.app/api/auth/callback`
7. Copy the **Client ID** and **Client secret**.

## 2. Add the keys to Vercel

In Vercel, open **gmail-today → Settings → Environment Variables** and add:

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the Client ID from step 1.7 |
| `GOOGLE_CLIENT_SECRET` | the Client secret from step 1.7 (mark it **Sensitive**) |

`SESSION_SECRET` and `ALLOWED_EMAIL` are already set. Then go to **Deployments**, open the latest one, and choose **Redeploy** so the new keys take effect.

## 3. Sign in and add it to your phone

- Open the app address and tap **Continue with Google**. Only the allowed account gets in, and any other account is turned away.
- **iPhone:** in Safari tap **Share → Add to Home Screen**. **Android:** in Chrome tap **⋮ → Add to Home screen** (or **Install app**).
- You stay signed in on that device until you choose **Sign out** from the avatar menu or remove access at https://myaccount.google.com/permissions.

## Running it on your computer (optional)

```bash
npm install
npm i -g vercel && vercel link && vercel env pull   # pulls the keys
vercel dev                                           # runs the app and /api together
```

Add `?demo` to the address to see sample mail.

## Keyboard

| Key | Action |
|---|---|
| J / K | Move down / up |
| Enter | Open |
| E | Done (archive) |
| R | Reply |
| C | Write a new email |
| / | Search all mail |
| 1 / 2 | Today / Sent |
| Esc | Close |
| Ctrl + Enter | Send |
