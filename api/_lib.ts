// Shared helpers for the sign-in server (files starting with "_" are not routes).

export const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.modify'].join(' ')
export const SESSION_COOKIE = 'gt_session'
export const STATE_COOKIE = 'gt_state'
const YEAR = 400 * 24 * 60 * 60 // browsers cap cookies at 400 days

export interface Config {
  clientId: string
  clientSecret: string
  secret: string
  allowed: string[]
}

export function config(): Config | null {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const secret = process.env.SESSION_SECRET
  const allowed = (process.env.ALLOWED_EMAIL ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (!clientId || !clientSecret || !secret || secret.length < 32 || !allowed.length) return null
  return { clientId, clientSecret, secret, allowed }
}

export function origin(req: Request) {
  return process.env.APP_URL?.replace(/\/$/, '') || new URL(req.url).origin
}

export function redirectUri(req: Request) {
  return `${origin(req)}/api/auth/callback`
}

/* ---------- cookies ---------- */

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? ''
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1))
  }
  return null
}

export function setCookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}
export const clearCookie = (name: string) => setCookie(name, '', 0)
export const sessionCookie = (value: string) => setCookie(SESSION_COOKIE, value, YEAR)

/* ---------- encryption (AES-GCM, key from SESSION_SECRET) ---------- */

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url')
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'))

async function key(secret: string) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export interface Session { rt: string; email: string }

export async function seal(data: Session, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), new TextEncoder().encode(JSON.stringify(data)))
  return `${b64u(iv)}.${b64u(new Uint8Array(ct))}`
}

export async function unseal(token: string | null, secret: string): Promise<Session | null> {
  if (!token) return null
  try {
    const [iv, ct] = token.split('.')
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await key(secret), unb64u(ct))
    return JSON.parse(new TextDecoder().decode(pt))
  } catch {
    return null
  }
}

/* ---------- responses ---------- */

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })
}

export function redirect(location: string, cookies: string[] = []) {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store' })
  cookies.forEach((c) => h.append('Set-Cookie', c))
  return new Response(null, { status: 302, headers: h })
}

export async function googleToken(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  return { ok: res.ok, data: (await res.json()) as Record<string, unknown> }
}

export function revoke(token: string) {
  return fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {})
}
