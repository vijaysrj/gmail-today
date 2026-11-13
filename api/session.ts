import { SESSION_COOKIE, clearCookie, config, googleToken, json, readCookie, unseal } from './_lib.js'

// Returns a fresh 1-hour Gmail access token for the signed-in owner.
export async function GET(req: Request) {
  const cfg = config()
  if (!cfg) return json({ error: 'not-configured' }, 503)
  const s = await unseal(readCookie(req, SESSION_COOKIE), cfg.secret)
  if (!s || !cfg.allowed.includes(s.email)) return json({ error: 'signed-out' }, 401)

  const { ok, data } = await googleToken({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: s.rt,
    grant_type: 'refresh_token',
  })
  if (!ok) {
    // Revoked or expired: sign out so the app shows the sign-in screen.
    if (data.error === 'invalid_grant') return json({ error: 'signed-out' }, 401, { 'Set-Cookie': clearCookie(SESSION_COOKIE) })
    return json({ error: 'google' }, 502)
  }
  return json({ access_token: data.access_token, expires_in: data.expires_in, email: s.email })
}
