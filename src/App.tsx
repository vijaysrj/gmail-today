import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment, Draft, MailSource, Person, Thread, ThreadSummary } from './types'
import { DemoSource } from './demo'
import { GmailSource, MAX_ATTACH_BYTES, ServerAuth } from './gmail'
import { fileSize, greeting, hue, initials, longTime, quote, shortTime, todayTitle, waitingFor } from './util'

const DEMO_ONLY = import.meta.env.VITE_DEMO_ONLY === '1'
const wantsDemo = () => DEMO_ONLY || new URLSearchParams(location.search).has('demo')

const ERRORS: Record<string, string> = {
  'not-allowed': 'That Google account is not allowed. Gmail Today is private to its owner.',
  cancelled: 'Sign-in was cancelled.',
  expired: 'That sign-in link expired. Please try again.',
  google: 'Google could not complete the sign-in. Please try again.',
  'no-refresh': 'Google did not grant offline access. Please try again.',
  'not-configured': 'Sign-in is not set up yet. Add the Google keys in Vercel (see SETUP.md).',
}

/* ================================================================== */
/* Root: check the saved sign-in, then show the mailbox                */
/* ================================================================== */

type Phase = 'checking' | 'signed-out' | 'not-configured' | 'offline' | 'ready'

export default function App() {
  const auth = useMemo(() => new ServerAuth(), [])
  const [source, setSource] = useState<MailSource | null>(() => (wantsDemo() ? new DemoSource() : null))
  const [phase, setPhase] = useState<Phase>(() => (wantsDemo() ? 'ready' : 'checking'))
  const [error] = useState(() => {
    const code = new URLSearchParams(location.search).get('error')
    if (code) history.replaceState(null, '', location.pathname)
    return code ? ERRORS[code] ?? 'Sign-in failed. Please try again.' : ''
  })

  useEffect(() => {
    if (wantsDemo()) return
    auth.check().then((s) => {
      if (s.status === 'signed-in') {
        const g = new GmailSource(auth)
        g.setEmail(s.email)
        setSource(g)
        setPhase('ready')
      } else setPhase(s.status)
    })
  }, [auth])

  const signOut = async () => {
    if (source?.isDemo) { location.href = location.pathname; return }
    await auth.signOut()
    setSource(null)
    setPhase('signed-out')
  }

  if (phase === 'checking') return <main className="welcome"><div className="sun" aria-hidden /></main>
  if (!source || phase !== 'ready')
    return <Welcome onSignIn={() => auth.signIn()} error={error || (phase === 'not-configured' ? ERRORS['not-configured'] : phase === 'offline' ? 'Could not reach the server. Check your connection and reload.' : '')} />
  return <Mailbox source={source} onSignOut={signOut} />
}

function Welcome(p: { onSignIn: () => void; error: string }) {
  return (
    <main className="welcome">
      <div className="sun" aria-hidden />
      <h1>Gmail Today</h1>
      <p className="lede">Your Gmail, one day at a time.<br />Just today's mail, and whatever is still waiting.</p>
      <button className="btn primary big" onClick={p.onSignIn}>
        <GoogleG /> Continue with Google
      </button>
      {p.error && <p className="error">{p.error}</p>}
      <p className="fine">Private app. Only the owner's Google account can sign in.</p>
    </main>
  )
}

/* ================================================================== */
/* Mailbox                                                              */
/* ================================================================== */

type View = 'today' | 'sent' | 'search'

interface ComposeState extends Draft { open: boolean; replyTitle?: string }
const emptyCompose: ComposeState = { open: false, to: '', subject: '', body: '' }

function Mailbox({ source, onSignOut }: { source: MailSource; onSignOut: () => void }) {
  const [me, setMe] = useState<Person | null>(null)
  const [view, setView] = useState<View>('today')
  const [today, setToday] = useState<ThreadSummary[] | null>(null)
  const [waiting, setWaiting] = useState<ThreadSummary[]>([])
  const [sent, setSent] = useState<ThreadSummary[] | null>(null)
  const [drafts, setDrafts] = useState<ThreadSummary[]>([])
  const [results, setResults] = useState<ThreadSummary[] | null>(null)
  const [more, setMore] = useState({ waiting: false, sent: false })
  const [loadingMore, setLoadingMore] = useState<'' | 'waiting' | 'sent'>('')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [compose, setCompose] = useState<ComposeState>(emptyCompose)
  const [toast, setToast] = useState('')
  const [loadError, setLoadError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const flash = useCallback((m: string) => {
    setToast(m)
    window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 2600)
  }, [])

  const loadToday = useCallback(async () => {
    try {
      const [t, w] = await Promise.all([source.today(), source.waiting()])
      setToday(t)
      setWaiting(w)
      setMore((m) => ({ ...m, waiting: !!source.hasMore?.('waiting') }))
      setLoadError('')
    } catch (e) {
      setLoadError((e as Error).message)
      setToday([])
    }
  }, [source])

  const loadSent = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([source.sent(), source.drafts()])
      setSent(s)
      setDrafts(d)
      setMore((m) => ({ ...m, sent: !!source.hasMore?.('sent') }))
    } catch (e) {
      setLoadError((e as Error).message)
      setSent([])
    }
  }, [source])

  useEffect(() => {
    source.me().then(setMe).catch(() => {})
    loadToday()
  }, [source, loadToday])

  useEffect(() => {
    if (view === 'sent' && sent === null) loadSent()
  }, [view, sent, loadSent])

  // refresh Today every 2 minutes while visible
  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') loadToday() }, 120_000)
    return () => window.clearInterval(id)
  }, [loadToday])

  const loadMore = async (list: 'waiting' | 'sent') => {
    if (!source.more || loadingMore) return
    setLoadingMore(list)
    try {
      const extra = await source.more(list)
      const add = (l: ThreadSummary[]) => [...l, ...extra.filter((x) => !l.some((y) => y.id === x.id))]
      if (list === 'waiting') setWaiting(add)
      else setSent((l) => add(l ?? []))
      setMore((m) => ({ ...m, [list]: !!source.hasMore?.(list) }))
    } catch (e) {
      flash(`Couldn't load more: ${(e as Error).message}`)
    } finally {
      setLoadingMore('')
    }
  }

  const runSearch = async (q: string) => {
    if (!q.trim()) { setView('today'); setResults(null); return }
    setView('search')
    setResults(null)
    try { setResults(await source.search(q.trim())) } catch (e) { setLoadError((e as Error).message); setResults([]) }
  }

  // flat list for keyboard navigation
  const rows: ThreadSummary[] = useMemo(() => {
    if (view === 'today') return [...(today ?? []), ...waiting]
    if (view === 'sent') return [...drafts, ...(sent ?? [])]
    return results ?? []
  }, [view, today, waiting, sent, drafts, results])

  useEffect(() => { setCursor(0) }, [view])

  const open = (t: ThreadSummary) => {
    if (t.isDraft) {
      setCompose({ open: true, to: t.to.map((p) => p.email).join(', '), subject: t.subject, body: t.snippet })
      return
    }
    setOpenId(t.id)
    setCursor(rows.findIndex((r) => r.id === t.id))
    if (t.unread) {
      const mark = (l: ThreadSummary[]) => l.map((x) => (x.id === t.id ? { ...x, unread: false } : x))
      setToday((l) => (l ? mark(l) : l))
      setWaiting(mark)
      source.markRead(t.id).catch(() => {})
    }
  }

  const archive = (id: string) => {
    setToday((l) => l?.filter((x) => x.id !== id) ?? l)
    setWaiting((l) => l.filter((x) => x.id !== id))
    if (openId === id) setOpenId(null)
    source.archive(id).then(() => flash('Done, archived')).catch((e) => flash(`Couldn't archive: ${e.message}`))
  }

  const send = async (d: ComposeState) => {
    await source.send(d)
    setCompose(emptyCompose)
    flash('Sent')
    setSent(null)
    if (view === 'sent') loadSent()
  }

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, [contenteditable]')) {
        if (e.key === 'Escape') (el as HTMLElement).blur()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const cur = rows[cursor]
      switch (e.key) {
        case 'j': case 'ArrowDown': setCursor((c) => Math.min(rows.length - 1, c + 1)); break
        case 'k': case 'ArrowUp': setCursor((c) => Math.max(0, c - 1)); break
        case 'Enter': case 'o': if (cur) open(cur); break
        case 'e': { const id = openId ?? cur?.id; if (id && view === 'today') archive(id); break }
        case 'c': setCompose({ ...emptyCompose, open: true }); break
        case '/': e.preventDefault(); searchRef.current?.focus(); break
        case '1': setView('today'); setOpenId(null); break
        case '2': setView('sent'); setOpenId(null); break
        case 'Escape': setOpenId(null); break
        default: return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const unreadToday = (today ?? []).filter((t) => t.unread).length
  const readToday = (today?.length ?? 0) - unreadToday

  return (
    <div className={`shell ${openId ? 'reading' : ''}`}>
      <header className="top">
        <div className="brand"><span className="dot" aria-hidden />Gmail Today</div>
        <nav className="switch" aria-label="Mailboxes">
          <button className={view === 'today' ? 'on' : ''} onClick={() => { setView('today'); setOpenId(null); setQuery('') }}>
            Today{unreadToday > 0 && <span className="badge">{unreadToday}</span>}
          </button>
          <button className={view === 'sent' ? 'on' : ''} onClick={() => { setView('sent'); setOpenId(null); setQuery('') }}>Sent</button>
        </nav>
        <form className="search" onSubmit={(e) => { e.preventDefault(); runSearch(query) }} role="search">
          <SearchIcon />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all mail" aria-label="Search all mail" />
          {query && <button type="button" className="clear" onClick={() => { setQuery(''); runSearch('') }} aria-label="Clear search">×</button>}
        </form>
        <button className="btn primary compose-btn" onClick={() => setCompose({ ...emptyCompose, open: true })}>
          <PenIcon /><span>Write</span>
        </button>
        <Menu me={me} demo={source.isDemo} onSignOut={onSignOut} />
      </header>

      <div className="stage">
        <main className="list" aria-busy={view === 'today' ? today === null : false}>
          {source.isDemo && <div className="demo-pill">Sample mail, so nothing is really sent</div>}
          {loadError && <div className="banner">Something went wrong talking to Gmail. {loadError}</div>}

          {view === 'today' && (
            <>
              <section className="hero">
                <p className="eyebrow">{greeting()}{source.isDemo && me ? `, ${me.name}` : ''}</p>
                <h1>{todayTitle()}</h1>
                {today && (
                  <>
                    <p className="sub">
                      {today.length === 0 ? 'Nothing new yet today.' : `${today.length} ${today.length === 1 ? 'email' : 'emails'} today, ${unreadToday} unread`}
                      {waiting.length > 0 && ` · ${waiting.length}${more.waiting ? '+' : ''} still waiting`}
                    </p>
                    {today.length > 0 && (
                      <div className="daybar" role="progressbar" aria-label="Read today" aria-valuemin={0} aria-valuemax={today.length} aria-valuenow={readToday}>
                        <span style={{ width: `${(readToday / today.length) * 100}%` }} />
                      </div>
                    )}
                  </>
                )}
              </section>

              {today === null ? <Skeleton /> : today.length === 0 ? (
                <Empty title="A quiet day so far" body="New mail will show up here as it arrives." />
              ) : (
                <ul className="rows">{today.map((t, i) => <Row key={t.id} t={t} active={openId === t.id} focused={cursor === i} onOpen={open} onArchive={archive} />)}</ul>
              )}

              {waiting.length > 0 && (
                <section className="waiting">
                  <h2>Still waiting <span>Unread from earlier, last 30 days</span></h2>
                  <ul className="rows">
                    {waiting.map((t, i) => (
                      <Row key={t.id} t={t} waiting active={openId === t.id} focused={cursor === (today?.length ?? 0) + i} onOpen={open} onArchive={archive} />
                    ))}
                  </ul>
                  {more.waiting && <MoreButton loading={loadingMore === 'waiting'} onClick={() => loadMore('waiting')} />}
                </section>
              )}
            </>
          )}

          {view === 'sent' && (
            <>
              <section className="hero compact"><h1>Sent</h1><p className="sub">What you've sent, with drafts on top.</p></section>
              {sent === null ? <Skeleton /> : (
                <>
                  {drafts.length > 0 && (
                    <ul className="rows">{drafts.map((t, i) => <Row key={t.draftId} t={t} sent focused={cursor === i} onOpen={open} />)}</ul>
                  )}
                  {sent.length === 0 && drafts.length === 0 ? <Empty title="Nothing sent yet" body="Press C to write your first email." /> : (
                    <ul className="rows">{sent.map((t, i) => <Row key={t.id} t={t} sent active={openId === t.id} focused={cursor === drafts.length + i} onOpen={open} />)}</ul>
                  )}
                  {more.sent && <MoreButton loading={loadingMore === 'sent'} onClick={() => loadMore('sent')} />}
                </>
              )}
            </>
          )}

          {view === 'search' && (
            <>
              <section className="hero compact"><h1>“{query}”</h1><p className="sub">Searching all of your mail.</p></section>
              {results === null ? <Skeleton /> : results.length === 0 ? <Empty title="No matches" body="Try a name, a word from the subject, or from:someone." /> : (
                <ul className="rows">{results.map((t, i) => <Row key={t.id} t={t} active={openId === t.id} focused={cursor === i} onOpen={open} />)}</ul>
              )}
            </>
          )}

          <p className="keys"><kbd>J</kbd><kbd>K</kbd> move · <kbd>Enter</kbd> open · <kbd>E</kbd> done · <kbd>R</kbd> reply · <kbd>C</kbd> write · <kbd>/</kbd> search</p>
        </main>

        {openId && (
          <Reader
            key={openId}
            id={openId}
            source={source}
            me={me}
            canArchive={view === 'today'}
            onClose={() => setOpenId(null)}
            onArchive={() => archive(openId)}
            onReply={(d) => setCompose({ ...d, open: true })}
          />
        )}
      </div>

      <button className="btn primary fab" onClick={() => setCompose({ ...emptyCompose, open: true })} aria-label="Write"><PenIcon /><span>Write</span></button>
      {compose.open && <Compose initial={compose} onClose={() => setCompose(emptyCompose)} onSend={send} />}
      <div className={`toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
    </div>
  )
}

/* ================================================================== */
/* Pieces                                                               */
/* ================================================================== */

function Avatar({ p, size = 40 }: { p: Person; size?: number }) {
  const h = hue(p.email)
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${h} 60% 88%)`, color: `hsl(${h} 45% 30%)` }} aria-hidden>
      {initials(p)}
    </span>
  )
}

function Row(p: {
  t: ThreadSummary; active?: boolean; focused?: boolean; waiting?: boolean; sent?: boolean
  onOpen: (t: ThreadSummary) => void; onArchive?: (id: string) => void
}) {
  const { t } = p
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => { if (p.focused) ref.current?.scrollIntoView({ block: 'nearest' }) }, [p.focused])
  const who = p.sent ? t.to[0] ?? t.from : t.from
  return (
    <li ref={ref} className={`row ${t.unread ? 'unread' : ''} ${p.active ? 'active' : ''} ${p.focused ? 'focused' : ''} ${p.waiting ? 'is-waiting' : ''}`}>
      <button className="row-main" onClick={() => p.onOpen(t)}>
        <Avatar p={who} />
        <span className="row-text">
          <span className="row-top">
            <span className="who">{p.sent ? <><span className="muted">To </span>{who.name}</> : who.name}{t.count > 1 && <span className="count">{t.count}</span>}</span>
            {t.isDraft ? <span className="tag draft">Draft</span> : p.waiting ? <span className="tag wait">{waitingFor(t.date)}</span> : <time>{shortTime(t.date)}</time>}
          </span>
          <span className="subject">{t.subject}</span>
          <span className="snippet">{t.snippet}</span>
        </span>
      </button>
      {p.onArchive && (
        <button className="done" onClick={() => p.onArchive!(t.id)} title="Done (E)" aria-label={`Mark done: ${t.subject}`}><CheckIcon /></button>
      )}
    </li>
  )
}

function MoreButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button className="more" onClick={onClick} disabled={loading}>{loading ? 'Loading…' : 'Show more'}</button>
  )
}

function Skeleton() {
  return (
    <ul className="rows skeleton" aria-label="Loading">
      {[0, 1, 2, 3].map((i) => <li key={i} className="row"><span className="sk-av" /><span className="sk-lines"><i /><i /><i /></span></li>)}
    </ul>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <div className="sun small" aria-hidden />
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  )
}

function Menu({ me, demo, onSignOut }: { me: Person | null; demo: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="menu">
      <button className="me" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account">
        {me ? <Avatar p={me} size={34} /> : <span className="avatar" style={{ width: 34, height: 34 }} />}
      </button>
      {open && (
        <div className="menu-pop" onMouseLeave={() => setOpen(false)}>
          <p className="menu-email">{demo ? 'Sample mailbox' : me?.email}</p>
          <button onClick={onSignOut}>{demo ? 'Leave sample mail' : 'Sign out'}</button>
        </div>
      )}
    </div>
  )
}

function Reader(p: {
  id: string; source: MailSource; me: Person | null; canArchive: boolean
  onClose: () => void; onArchive: () => void; onReply: (d: Draft & { replyTitle?: string }) => void
}) {
  const [thread, setThread] = useState<Thread | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { p.source.thread(p.id).then(setThread).catch((e) => setErr(e.message)) }, [p.id, p.source])

  const reply = useCallback(() => {
    if (!thread) return
    const last = thread.messages[thread.messages.length - 1]
    const mine = p.me && last.from.email.toLowerCase() === p.me.email.toLowerCase()
    const to = mine ? last.to.map((x) => x.email).join(', ') : last.from.email
    const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`
    p.onReply({
      to, subject,
      body: `\n\nOn ${longTime(last.date)}, ${last.from.name} wrote:\n${quote(last.text.trim())}`,
      threadId: thread.id, inReplyTo: last.messageIdHeader, references: last.references,
      replyTitle: `Reply to ${mine ? last.to[0]?.name ?? to : last.from.name}`,
    })
  }, [thread, p])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); reply() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reply])

  return (
    <aside className="reader" aria-label="Conversation">
      <div className="reader-bar">
        <button className="icon" onClick={p.onClose} aria-label="Close (Esc)"><BackIcon /></button>
        <div className="spacer" />
        {p.canArchive && <button className="btn soft" onClick={p.onArchive}><CheckIcon /> Done</button>}
        <button className="btn primary" onClick={reply} disabled={!thread}><ReplyIcon /> Reply</button>
      </div>
      {err && <div className="banner">{err}</div>}
      {!thread && !err && <div className="reader-loading"><Skeleton /></div>}
      {thread && (
        <article className="conv">
          <h1>{thread.subject}</h1>
          {thread.messages.map((m, i) => (
            <section key={m.id} className={`msg ${i < thread.messages.length - 1 ? 'older' : ''}`}>
              <header>
                <Avatar p={m.from} size={36} />
                <div>
                  <strong>{m.from.name}</strong> <span className="muted">&lt;{m.from.email}&gt;</span>
                  <div className="muted small">to {m.to.map((x) => x.name).join(', ') || 'you'} · {longTime(m.date)}</div>
                </div>
              </header>
              {m.html ? <HtmlBody html={m.html} /> : <pre className="body">{m.text}</pre>}
              {m.attachments.length > 0 && (
                <div className="files">
                  {m.attachments.map((a) => <AttachmentChip key={a.id} a={a} source={p.source} />)}
                </div>
              )}
            </section>
          ))}
          <button className="reply-strip" onClick={reply}>Write a reply…</button>
        </article>
      )}
    </aside>
  )
}

function AttachmentChip({ a, source }: { a: Attachment; source: MailSource }) {
  const [busy, setBusy] = useState(false)
  const download = async () => {
    if (!source.attachment || busy) return
    setBusy(true)
    try {
      const blob = await source.attachment(a)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = a.filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button className="file" onClick={download} title={`Download ${a.filename}`}>
      <FileIcon />
      <span className="file-name">{a.filename}</span>
      <span className="file-size">{busy ? 'Downloading…' : fileSize(a.size)}</span>
    </button>
  )
}

/** Renders email HTML in a sandbox: no scripts can run, links open in a new tab. */
function HtmlBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [h, setH] = useState(120)
  const doc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
      html,body{margin:0;padding:0;font:15px/1.6 Inter,system-ui,sans-serif;color:#1f2a37;word-wrap:break-word;overflow-wrap:anywhere}
      img{max-width:100%;height:auto} table{max-width:100%} a{color:#2457c5}
      blockquote{margin:0 0 0 .6em;padding-left:.8em;border-left:2px solid #dbe2ea;color:#5b6878}
    </style></head><body>${html}</body></html>`,
    [html],
  )
  const fit = () => {
    const d = ref.current?.contentDocument
    if (d?.body) setH(Math.max(60, d.documentElement.scrollHeight))
  }
  return (
    <iframe
      ref={ref}
      className="html-body"
      title="Email content"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      style={{ height: h }}
      onLoad={() => { fit(); setTimeout(fit, 400); setTimeout(fit, 1500) }}
    />
  )
}

function Compose({ initial, onClose, onSend }: { initial: ComposeState; onClose: () => void; onSend: (d: ComposeState) => Promise<void> }) {
  const [d, setD] = useState(initial)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [dragging, setDragging] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const toRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const files = d.attachments ?? []
  const total = files.reduce((n, f) => n + f.size, 0)

  useEffect(() => {
    if (initial.to) {
      bodyRef.current?.focus()
      bodyRef.current?.setSelectionRange(0, 0)
    } else toRef.current?.focus()
  }, [initial.to])

  const addFiles = (list: FileList | File[] | null) => {
    const incoming = Array.from(list ?? [])
    if (!incoming.length) return
    setD((cur) => {
      const next = [...(cur.attachments ?? []), ...incoming]
      const size = next.reduce((n, f) => n + f.size, 0)
      setErr(size > MAX_ATTACH_BYTES ? `Attachments add up to ${fileSize(size)}. Gmail allows about 24 MB per email, so remove some files or share a Drive link instead.` : '')
      return { ...cur, attachments: next }
    })
  }

  const removeFile = (i: number) => {
    setD((cur) => {
      const next = (cur.attachments ?? []).filter((_, j) => j !== i)
      if (next.reduce((n, f) => n + f.size, 0) <= MAX_ATTACH_BYTES) setErr('')
      return { ...cur, attachments: next }
    })
  }

  const submit = async () => {
    if (!d.to.trim()) { setErr('Who is this going to?'); toRef.current?.focus(); return }
    if (total > MAX_ATTACH_BYTES) { setErr(`Attachments add up to ${fileSize(total)}. Gmail allows about 24 MB per email.`); return }
    setSending(true)
    setErr('')
    try { await onSend(d) } catch (e) { setErr((e as Error).message); setSending(false) }
  }

  return (
    <div className="compose-wrap" onKeyDown={(e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() }
    }}>
      <div
        className={`compose ${dragging ? 'dragging' : ''}`}
        role="dialog"
        aria-label={initial.replyTitle ?? 'New email'}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
      >
        <div className="compose-head">
          <strong>{initial.replyTitle ?? 'New email'}</strong>
          <button className="icon" onClick={onClose} aria-label="Close (Esc)">×</button>
        </div>
        <label className="field"><span>To</span><input id="compose-to" ref={toRef} value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} placeholder="name@example.com" /></label>
        <label className="field"><span>Subject</span><input id="compose-subject" value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} placeholder="What's it about?" /></label>
        <textarea
          id="compose-body"
          ref={bodyRef}
          value={d.body}
          onChange={(e) => setD({ ...d, body: e.target.value })}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files) } }}
          placeholder="Write something…"
        />
        {files.length > 0 && (
          <div className="files compose-files">
            {files.map((f, i) => (
              <span className="file" key={`${f.name}-${i}`}>
                <FileIcon />
                <span className="file-name">{f.name}</span>
                <span className="file-size">{fileSize(f.size)}</span>
                <button className="file-x" onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`}>×</button>
              </span>
            ))}
          </div>
        )}
        {err && <p className="error">{err}</p>}
        <div className="compose-foot">
          <div className="foot-left">
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
            <button className="icon attach" onClick={() => fileRef.current?.click()} aria-label="Attach files" title="Attach files"><ClipIcon /></button>
            <span className="muted small hint">{files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'}, ${fileSize(total)}` : 'Drop files here · Ctrl + Enter to send'}</span>
          </div>
          <button className="btn primary" onClick={submit} disabled={sending}><SendIcon /> {sending ? (files.length ? 'Uploading…' : 'Sending…') : 'Send'}</button>
        </div>
        {dragging && <div className="drop-hint">Drop to attach</div>}
      </div>
    </div>
  )
}

/* ================================================================== */
/* Icons                                                                */
/* ================================================================== */

const I = (path: React.ReactNode) => () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{path}</svg>
)
const SearchIcon = I(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>)
const PenIcon = I(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>)
const CheckIcon = I(<path d="M20 6 9 17l-5-5" />)
const BackIcon = I(<path d="M15 18l-6-6 6-6" />)
const ReplyIcon = I(<><path d="M9 17 4 12l5-5" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></>)
const ClipIcon = I(<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />)
const FileIcon = I(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></>)
const SendIcon = I(<><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>)
const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
)
