import type { Draft, MailSource, Message, Person, Thread, ThreadSummary } from './types'

const me: Person = { name: 'You', email: 'you@gmail.com' }

function at(daysAgo: number, h: number, m: number) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(h, m, 0, 0)
  // keep "today" items in the past
  if (daysAgo === 0 && d > new Date()) d.setTime(Date.now() - (h + 1) * 7 * 60_000)
  return d
}

interface Seed {
  id: string
  from: Person
  subject: string
  body: string
  date: Date
  unread: boolean
  inbox: boolean
  sent?: boolean
  draft?: boolean
  to?: Person[]
}

const P = {
  ananya: { name: 'Ananya Rao', email: 'ananya@studio-north.in' },
  rahul: { name: 'Rahul Mehta', email: 'rahul.mehta@gmail.com' },
  bank: { name: 'Bank Alerts', email: 'alerts@bank.example' },
  meera: { name: 'Meera Iyer', email: 'meera@lumen.dev' },
  karthik: { name: 'Karthik S', email: 'karthik@fieldwork.co' },
  amma: { name: 'Amma', email: 'amma.family@gmail.com' },
  priya: { name: 'Priya Nair', email: 'priya@openroad.travel' },
  dev: { name: 'Dev Patel', email: 'dev@buildkite.example' },
}

const seeds: Seed[] = [
  {
    id: 't1', from: P.ananya, subject: 'Homepage concepts are ready',
    body: `Hi,\n\nThe three homepage directions are up on the board. My favourite is the second one, warmer palette, bigger type, and the hero finally breathes.\n\nCould you pick one by Monday? Then we can start on the inner pages.\n\nThanks,\nAnanya`,
    date: at(0, 10, 42), unread: true, inbox: true,
  },
  {
    id: 't2', from: P.rahul, subject: 'Dinner Saturday?',
    body: `Hey!\n\nA few of us are going to that new Kerala place in Indiranagar on Saturday around 8. You in?\n\nRahul`,
    date: at(0, 9, 15), unread: true, inbox: true,
  },
  {
    id: 't3', from: P.bank, subject: 'Your statement for October is ready',
    body: `Dear Customer,\n\nYour account statement for October is now available in NetBanking.\n\nThis is an automated message.`,
    date: at(0, 7, 30), unread: false, inbox: true,
  },
  {
    id: 't4', from: P.meera, subject: 'Re: API rate limits',
    body: `Good catch on the retry logic. I pushed a fix that backs off properly, so we shouldn't hit the 429s anymore.\n\nCan you sanity-check it before we ship tomorrow?\n\nMeera`,
    date: at(0, 8, 5), unread: false, inbox: true,
  },
  {
    id: 't5', from: P.karthik, subject: 'Contract draft for review',
    body: `Hi,\n\nAttaching the revised contract with the payment terms we discussed. Let me know if anything needs to change.\n\nBest,\nKarthik`,
    date: at(2, 16, 20), unread: true, inbox: true,
  },
  {
    id: 't6', from: P.amma, subject: 'Photos from Diwali',
    body: `Kanna, here are the photos from Diwali. Call me when you're free.\n\nAmma`,
    date: at(4, 19, 2), unread: true, inbox: true,
  },
  {
    id: 't7', from: P.priya, subject: 'Your Goa itinerary',
    body: `Hi,\n\nHere's the plan for your December trip: flights on the 20th, three nights in Assagao, and a boat day on the 22nd.\n\nPriya`,
    date: at(6, 11, 48), unread: true, inbox: true,
  },
  {
    id: 's1', from: me, to: [P.dev], subject: 'Deploy checklist',
    body: `Hi Dev,\n\nSharing the deploy checklist for Friday. Ping me if anything looks off.\n`,
    date: at(0, 11, 10), unread: false, inbox: false, sent: true,
  },
  {
    id: 's2', from: me, to: [P.ananya], subject: 'Re: Brand colours',
    body: `Love the warmer direction. Let's go with it.\n`,
    date: at(1, 18, 30), unread: false, inbox: false, sent: true,
  },
  {
    id: 's3', from: me, to: [P.amma], subject: 'Coming home for Pongal',
    body: `Amma, booked tickets for Pongal. Reaching on the 13th morning.`,
    date: at(3, 21, 0), unread: false, inbox: false, sent: true,
  },
  {
    id: 'd1', from: me, to: [P.karthik], subject: 'Re: Contract draft for review',
    body: `Hi Karthik, thanks. Two small changes on clause 4…`,
    date: at(0, 12, 0), unread: false, inbox: false, draft: true,
  },
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function summary(s: Seed): ThreadSummary {
  return {
    id: s.id,
    from: s.from,
    to: s.to ?? [me],
    subject: s.subject,
    snippet: s.body.replace(/\s+/g, ' ').replace(/^Hi\s+\w+,?\s*/i, '').slice(0, 140),
    date: s.date,
    unread: s.unread,
    count: 1,
    isDraft: s.draft,
    draftId: s.draft ? s.id : undefined,
  }
}

const byDate = (a: ThreadSummary, b: ThreadSummary) => b.date.getTime() - a.date.getTime()

export class DemoSource implements MailSource {
  readonly isDemo = true
  private data = seeds.map((s) => ({ ...s }))

  async me() { return { name: 'there', email: me.email } }

  async today() {
    await sleep(350)
    const start = new Date(); start.setHours(0, 0, 0, 0)
    return this.data.filter((s) => s.inbox && s.date >= start).map(summary).sort(byDate)
  }
  async waiting() {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    return this.data.filter((s) => s.inbox && s.unread && s.date < start).map(summary).sort(byDate)
  }
  async sent() {
    await sleep(250)
    return this.data.filter((s) => s.sent).map(summary).sort(byDate)
  }
  async drafts() {
    return this.data.filter((s) => s.draft).map(summary).sort(byDate)
  }
  async search(q: string) {
    await sleep(200)
    const n = q.toLowerCase()
    return this.data
      .filter((s) => !s.draft && [s.subject, s.body, s.from.name, s.from.email].some((x) => x.toLowerCase().includes(n)))
      .map(summary).sort(byDate)
  }
  async thread(id: string): Promise<Thread> {
    await sleep(120)
    const s = this.data.find((x) => x.id === id)!
    const msg: Message = {
      id: s.id, threadId: s.id, from: s.from, to: s.to ?? [me], cc: [],
      subject: s.subject, date: s.date, html: null, text: s.body,
      messageIdHeader: `<${s.id}@demo>`, references: '', attachments: [],
    }
    return { id, subject: s.subject, messages: [msg] }
  }
  async markRead(id: string) {
    const s = this.data.find((x) => x.id === id)
    if (s) s.unread = false
  }
  async archive(id: string) {
    const s = this.data.find((x) => x.id === id)
    if (s) s.inbox = false
  }
  async send(d: Draft) {
    await sleep(400)
    this.data.push({
      id: `s${Date.now()}`, from: me, to: [{ name: d.to, email: d.to }], subject: d.subject || '(no subject)',
      body: d.body, date: new Date(), unread: false, inbox: false, sent: true,
    })
  }
}
