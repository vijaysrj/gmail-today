import { STATE_COOKIE, clearCookie, config, googleToken, readCookie, redirect, redirectUri, revoke, seal, sessionCookie } from '../_lib.js'

export async function GET(req: Request) {
  const cfg = config()
  if (!cfg) return redirect('/?error=not-configured')
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const expected = readCookie(req, STATE_COOKIE)
  const clearState = clearCookie(STATE_COOKIE)

  if (url.searchParams.get('error')) return redirect('/?error=cancelled', [clearState])
  if (!code || !state || !expected || state !== expected) return redirect('/?error=expired', [clearState])

  const { ok, data } = await googleToken({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: redirectUri(req),
    grant_type: 'authorization_code',
  })
  if (!ok) return redirect('/?error=google', [clearState])

  // The id_token came straight from Google over TLS, so its claims can be read directly.
  const idToken = String(data.id_token ?? '')
  let email = ''
  let verified = false
  try {
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString())
    email = String(claims.email ?? '').toLowerCase()
    verified = claims.email_verified === true || claims.email_verified === 'true'
  } catch { /* fall through */ }

  const refresh = typeof data.refresh_token === 'string' ? data.refresh_token : ''
  if (!verified || !cfg.allowed.includes(email)) {
    if (refresh || data.access_token) await revoke(refresh || String(data.access_token))
    return redirect('/?error=not-allowed', [clearState])
  }
  if (!refresh) return redirect('/?error=no-refresh', [clearState])

  const session = await seal({ rt: refresh, email }, cfg.secret)
  return redirect('/', [clearState, sessionCookie(session)])
}
