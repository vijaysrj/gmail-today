import { SCOPES, STATE_COOKIE, config, redirect, redirectUri, setCookie } from '../_lib.js'

export async function GET(req: Request) {
  const cfg = config()
  if (!cfg) return redirect('/?error=not-configured')
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url')
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline', // gives a long-lived refresh token, so you stay signed in
    prompt: 'consent',
    include_granted_scopes: 'true',
    login_hint: cfg.allowed[0],
    state,
  }).toString()
  return redirect(url.toString(), [setCookie(STATE_COOKIE, state, 600)])
}
