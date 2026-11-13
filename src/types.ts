export interface Person {
  name: string
  email: string
}

/** One row in a list: the newest message of a conversation. */
export interface ThreadSummary {
  id: string
  from: Person
  to: Person[]
  subject: string
  snippet: string
  date: Date
  unread: boolean
  count: number
  isDraft?: boolean
  draftId?: string
}

export interface Attachment {
  messageId: string
  id: string
  filename: string
  mimeType: string
  size: number
}

export interface Message {
  id: string
  threadId: string
  from: Person
  to: Person[]
  cc: Person[]
  subject: string
  date: Date
  html: string | null
  text: string
  messageIdHeader: string
  references: string
  attachments: Attachment[]
}

export interface Thread {
  id: string
  subject: string
  messages: Message[]
}

export interface Draft {
  to: string
  subject: string
  body: string
  /** When replying */
  threadId?: string
  inReplyTo?: string
  references?: string
  attachments?: File[]
}

export interface MailSource {
  readonly isDemo: boolean
  me(): Promise<Person>
  today(): Promise<ThreadSummary[]>
  waiting(): Promise<ThreadSummary[]>
  sent(): Promise<ThreadSummary[]>
  drafts(): Promise<ThreadSummary[]>
  search(q: string): Promise<ThreadSummary[]>
  thread(id: string): Promise<Thread>
  markRead(threadId: string): Promise<void>
  archive(threadId: string): Promise<void>
  send(d: Draft): Promise<void>
  /** Downloads one attachment of a received email. */
  attachment?(a: Attachment): Promise<Blob>
  /** True when the last waiting()/sent() call had more results than it returned. */
  hasMore?(list: 'waiting' | 'sent'): boolean
  /** Loads the next page of that list. */
  more?(list: 'waiting' | 'sent'): Promise<ThreadSummary[]>
}
