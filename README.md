# Gmail Today

A calm, private Gmail client that shows only **today's mail**, plus **Still waiting** (unread mail from the last 30 days) and **Sent** (with drafts on top). No ads, no clutter, no extra menus.

- Vite + React front end, with a few Vercel functions in `/api` for Google sign-in
- Stays signed in on each device (encrypted, long-lived cookie). Only the account in `ALLOWED_EMAIL` can sign in
- Read, reply, write with attachments, download attachments, mark done (archive), search all mail
- Keyboard-first, works on phones (add to home screen), light and dark themes
- `?demo` shows sample mail

See **SETUP.md** for the Google Cloud and Vercel setup.
