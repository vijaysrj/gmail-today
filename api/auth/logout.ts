import { SESSION_COOKIE, clearCookie, config, readCookie, revoke, unseal } from '../_lib.js'

export async function POST(req: Request) {
  const cfg = config()
  if (cfg) {
    const s = await unseal(readCookie(req, SESSION_COOKIE), cfg.secret)
    if (s) await revoke(s.rt)
  }
  return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookie(SESSION_COOKIE), 'Cache-Control': 'no-store' } })
}
