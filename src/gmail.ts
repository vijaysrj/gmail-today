import type { Attachment, Draft, MailSource, Message, Person, Thread, ThreadSummary } from './types'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

/* ------------------------------------------------------------------ */
/* Sign-in: the small server in /api keeps you signed in with a        */
/* long-lived, encrypted cookie and hands out 1-hour Gmail tokens.     */
/* ------------------------------------------------------------------ */

export type SessionState = { status: 'signed-in'; email: string } | { status: 'signed-out' | 'not-configured' | 'offline' }

export class ServerAuth {
  private cached: { token: string; exp: number } | null = null
  private inflight: Promise<string> | null = null

  /** Checks for a saved sign-in. */
  async check(): Promise<SessionState> {
    try {
      const r = await fetch('/api/session', { credentials: 'same-origin' })
      if (r.status === 503) return { status: 'not-configured' }
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return { status: r.status === 401 ? 'signed-out' : 'offline' }
      const d = await r.json()
      this.cached = { token: d.access_token, exp: Date.now() + (d.expires_in ?? 3600) * 1000 }
      return { status: 'signed-in', email: d.email }
    } catch {
      return { status: 'offline' }
    }
  }

  signIn() {
    location.href = '/api/auth/login'
  }

  async signOut() {
    this.cached = null
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
  }

  forget() {
    this.cached = null
  }

  async token(): Promise<string> {
    if (this.cached && Date.now() < this.cached.exp - 120_000) return this.cached.token
    this.inflight ??= (async () => {
      try {
        const s = await this.check()
        if (s.status !== 'signed-in' || !this.cached) {
          this.signIn()
          throw new Error('Signed out')
        }
        return this.cached.token
      } finally {
        this.inflight = null
      }
    })()
    return this.inflight
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

interface GHeader { name: string; value: string }
interface GPart { mimeType: string; filename?: string; body?: { data?: string; size?: number; attachmentId?: string }; parts?: GPart[]; headers?: GHeader[] }
interface GMessage { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GPart }
interface GThread { id: string; historyId?: string; messages?: GMessage[] }

function header(m: GMessage, name: string): string {
  const h = m.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())
  return h?.value ?? ''
}

export function parsePerson(raw: string): Person {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].trim() || m[2], email: m[2].trim() }
  const e = raw.trim()
  return { name: e.split('@')[0] || e, email: e }
}

export function parsePeople(raw: string): Person[] {
  if (!raw.trim()) return []
  // split on commas that are not inside quotes
  return raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(parsePerson).filter((p) => p.email)
}

function decodeB64Url(data: string): string {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function findPart(p: GPart | undefined, mime: string): string | null {
  if (!p) return null
  if (p.mimeType === mime && p.body?.data) return decodeB64Url(p.body.data)
  for (const c of p.parts ?? []) {
    const r = findPart(c, mime)
    if (r) return r
  }
  return null
}

function findAttachments(p: GPart | undefined, messageId: string, out: Attachment[] = []): Attachment[] {
  if (!p) return out
  if (p.filename && p.body?.attachmentId) {
    out.push({ messageId, id: p.body.attachmentId, filename: p.filename, mimeType: p.mimeType, size: p.body.size ?? 0 })
  }
  for (const c of p.parts ?? []) findAttachments(c, messageId, out)
  return out
}

/* ---------- building outgoing mail (MIME) ---------- */

export const MAX_ATTACH_BYTES = 24 * 1024 * 1024 // Gmail's limit is 25 MB including encoding overhead

function wrap76(b64: string) {
  return b64.replace(/.{1,76}/g, '$&\r\n')
}

function bytesToB64(bytes: Uint8Array) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const quotedName = (name: string) => encodeHeader(name.replace(/["\\\r\n]/g, '_'))

export async function buildMime(d: Draft): Promise<string> {
  const head = [
    `To: ${d.to}`,
    `Subject: ${encodeHeader(d.subject)}`,
    'MIME-Version: 1.0',
  ]
  if (d.inReplyTo) {
    head.push(`In-Reply-To: ${d.inReplyTo}`)
    head.push(`References: ${[d.references, d.inReplyTo].filter(Boolean).join(' ')}`)
  }
  const textPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(bytesToB64(new TextEncoder().encode(d.body))),
  ].join('\r\n')

  const files = d.attachments ?? []
  if (!files.length) return `${head.join('\r\n')}\r\n${textPart}`

  const boundary = `gt_${crypto.getRandomValues(new Uint32Array(2)).join('_')}`
  const parts = [textPart]
  for (const f of files) {
    const data = bytesToB64(new Uint8Array(await f.arrayBuffer()))
    const type = f.type || 'application/octet-stream'
    parts.push([
      `Content-Type: ${type}; name="${quotedName(f.name)}"`,
      `Content-Disposition: attachment; filename="${quotedName(f.name)}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(data),
    ].join('\r\n'))
  }
  head.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
  return `${head.join('\r\n')}\r\n\r\n${parts.map((p) => `--${boundary}\r\n${p}`).join('\r\n')}\r\n--${boundary}--\r\n`
}

function decodeEntities(s: string) {
  const t = document.createElement('textarea')
  t.innerHTML = s
  return t.value
}

function toSummary(t: GThread, opts: { pickLast?: (m: GMessage) => boolean } = {}): ThreadSummary | null {
  const msgs = t.messages ?? []
  if (!msgs.length) return null
  const candidates = opts.pickLast ? msgs.filter(opts.pickLast) : msgs
  const m = candidates[candidates.length - 1] ?? msgs[msgs.length - 1]
  return {
    id: t.id,
    from: parsePerson(header(m, 'From')),
    to: parsePeople(header(m, 'To')),
    subject: header(m, 'Subject') || '(no subject)',
    snippet: decodeEntities(m.snippet ?? ''),
    date: new Date(Number(m.internalDate)),
    unread: msgs.some((x) => x.labelIds?.includes('UNREAD')),
    count: msgs.length,
  }
}

function encodeHeader(v: string) {
  // RFC 2047 for non-ASCII (names, subjects)
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(v)))}?=`
}

export function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx])
      }
    }),
  )
  return out
}

/* ------------------------------------------------------------------ */
/* Gmail-backed mail source                                             */
/* ------------------------------------------------------------------ */

const notSent = (m: GMessage) => !m.labelIds?.includes('SENT')
const isSent = (m: GMessage) => !!m.labelIds?.includes('SENT')

export class GmailSource implements MailSource {
  readonly isDemo = false
  private auth: ServerAuth
  private myEmail = ''
  private pages: Record<'waiting' | 'sent', { q: string; next?: string }> = { waiting: { q: '' }, sent: { q: '' } }
  /** Thread headers we already fetched, reused until the thread changes (its historyId moves). */
  private cache = new Map<string, GThread>()
  constructor(auth: ServerAuth) {
    this.auth = auth
  }

  private async call<T>(path: string, init: RequestInit = {}, retry = true, attempt = 0): Promise<T> {
    const token = await this.auth.token()
    const res = await fetch(path.startsWith('https://') ? path : `${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    if (res.status === 401 && retry) {
      this.auth.forget()
      return this.call(path, init, false, attempt)
    }
    if (!res.ok) {
      const text = await res.text()
      // Gmail allows a limited number of requests per second; wait and try again.
      const limited = res.status === 429 || (res.status === 403 && /rate ?limit|quota/i.test(text)) || res.status >= 500
      if (limited && attempt < 4) {
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt + Math.random() * 400))
        return this.call(path, init, retry, attempt + 1)
      }
      if (limited) throw new Error('Gmail is busy right now. Please try again in a minute.')
      throw new Error(`Gmail said ${res.status}: ${text.slice(0, 200)}`)
    }
    return res.status === 204 ? (undefined as T) : res.json()
  }

  setEmail(e: string) {
    this.myEmail = e
  }

  async me(): Promise<Person> {
    if (this.myEmail) return { name: this.myEmail.split('@')[0], email: this.myEmail }
    const p = await this.call<{ emailAddress: string }>('/profile')
    this.myEmail = p.emailAddress
    return { name: p.emailAddress.split('@')[0], email: p.emailAddress }
  }

  private async listThreads(q: string, max = 40, pickLast?: (m: GMessage) => boolean, page?: 'waiting' | 'sent', token?: string): Promise<ThreadSummary[]> {
    const r = await this.call<{ threads?: { id: string; historyId?: string }[]; nextPageToken?: string }>(
      `/threads?maxResults=${max}&q=${encodeURIComponent(q)}${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`,
    )
    if (page) this.pages[page] = { q, next: r.nextPageToken }
    const full = await pool(r.threads ?? [], 4, async ({ id, historyId }) => {
      const hit = this.cache.get(id)
      if (hit && historyId && hit.historyId === historyId) return hit
      const t = await this.call<GThread>(`/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`)
      this.cache.set(id, t)
      return t
    })
    return full.map((t) => toSummary(t, { pickLast })).filter((x): x is ThreadSummary => !!x)
  }

  today() {
    const after = Math.floor(startOfToday().getTime() / 1000)
    return this.listThreads(`in:inbox after:${after}`, 50, (m) => !m.labelIds?.includes('SENT'))
  }

  waiting() {
    const before = Math.floor(startOfToday().getTime() / 1000)
    return this.listThreads(`in:inbox is:unread before:${before} newer_than:30d`, 30, notSent, 'waiting')
  }

  sent() {
    return this.listThreads('in:sent', 30, isSent, 'sent')
  }

  hasMore(list: 'waiting' | 'sent') {
    return !!this.pages[list].next
  }

  more(list: 'waiting' | 'sent') {
    const { q, next } = this.pages[list]
    if (!next) return Promise.resolve([])
    return this.listThreads(q, 30, list === 'sent' ? isSent : notSent, list, next)
  }

  async drafts(): Promise<ThreadSummary[]> {
    const r = await this.call<{ drafts?: { id: string; message: { id: string } }[] }>('/drafts?maxResults=20')
    const list = r.drafts ?? []
    const full = await pool(list, 8, (d) =>
      this.call<{ id: string; message: GMessage }>(`/drafts/${d.id}?format=metadata`),
    )
    return full.map((d) => ({
      id: d.message.threadId,
      draftId: d.id,
      isDraft: true,
      from: { name: 'You', email: this.myEmail },
      to: parsePeople(header(d.message, 'To')),
      subject: header(d.message, 'Subject') || '(no subject)',
      snippet: decodeEntities(d.message.snippet ?? ''),
      date: new Date(Number(d.message.internalDate)),
      unread: false,
      count: 1,
    }))
  }

  search(q: string) {
    return this.listThreads(q, 30)
  }

  async thread(id: string): Promise<Thread> {
    const t = await this.call<GThread>(`/threads/${id}?format=full`)
    const messages: Message[] = (t.messages ?? [])
      .filter((m) => !m.labelIds?.includes('DRAFT'))
      .map((m) => {
        const html = findPart(m.payload, 'text/html')
        const text = findPart(m.payload, 'text/plain') ?? decodeEntities(m.snippet ?? '')
        return {
          id: m.id,
          threadId: m.threadId,
          from: parsePerson(header(m, 'From')),
          to: parsePeople(header(m, 'To')),
          cc: parsePeople(header(m, 'Cc')),
          subject: header(m, 'Subject') || '(no subject)',
          date: new Date(Number(m.internalDate)),
          html,
          text,
          messageIdHeader: header(m, 'Message-ID') || header(m, 'Message-Id'),
          references: header(m, 'References'),
          attachments: findAttachments(m.payload, m.id),
        }
      })
    return { id: t.id, subject: messages[0]?.subject ?? '(no subject)', messages }
  }

  async markRead(threadId: string) {
    await this.call(`/threads/${threadId}/modify`, { method: 'POST', body: JSON.stringify({ removeLabelIds: ['UNREAD'] }) })
  }

  async archive(threadId: string) {
    await this.call(`/threads/${threadId}/modify`, { method: 'POST', body: JSON.stringify({ removeLabelIds: ['INBOX'] }) })
  }

  async send(d: Draft) {
    const mime = await buildMime(d)
    // Upload endpoint: allows messages up to 35 MB (attachments), unlike the 5 MB JSON endpoint.
    const boundary = `gt_up_${Date.now()}`
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(d.threadId ? { threadId: d.threadId } : {}),
      `--${boundary}`,
      'Content-Type: message/rfc822',
      '',
      mime,
      `--${boundary}--`,
      '',
    ].join('\r\n')
    await this.call('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
  }

  async attachment(a: Attachment): Promise<Blob> {
    const r = await this.call<{ data: string }>(`/messages/${a.messageId}/attachments/${a.id}`)
    const bin = atob(r.data.replace(/-/g, '+').replace(/_/g, '/'))
    return new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))], { type: a.mimeType || 'application/octet-stream' })
  }

}
