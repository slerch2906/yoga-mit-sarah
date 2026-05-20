/**
 * Mailtrap-Hilfsfunktionen für E-Mail-Tests.
 * Dokumentation: https://api-docs.mailtrap.io/
 *
 * Kostenloses Konto: https://mailtrap.io
 * Token: Dashboard → API → API Tokens
 */

const BASE = 'https://mailtrap.io/api'

interface MailtrapMessage {
  id: number
  subject: string
  to_email: string
  html_body: string
  text_body: string
  created_at: string
}

function getHeaders() {
  const token = process.env.MAILTRAP_API_TOKEN
  if (!token) throw new Error('MAILTRAP_API_TOKEN nicht in .env.test gesetzt')
  return {
    'Api-Token': token,
    'Content-Type': 'application/json',
  }
}

/** Alle Emails in einem Postfach holen */
async function listMessages(inboxId: string): Promise<MailtrapMessage[]> {
  const res = await fetch(`${BASE}/inboxes/${inboxId}/messages`, { headers: getHeaders() })
  if (!res.ok) throw new Error(`Mailtrap-Fehler: ${res.status} ${await res.text()}`)
  return res.json()
}

/** Postfach leeren (vor jedem Test-Run empfohlen) */
export async function clearInbox(): Promise<void> {
  const inboxId = process.env.MAILTRAP_INBOX_ID
  if (!inboxId) return
  await fetch(`${BASE}/inboxes/${inboxId}/clean`, {
    method: 'PATCH',
    headers: getHeaders(),
  })
}

/**
 * Wartet bis eine E-Mail mit dem angegebenen Betreff-Muster eintrifft.
 * Wirft einen Fehler wenn nach timeoutMs keine E-Mail angekommen ist.
 */
export async function waitForEmail(options: {
  to: string
  subjectContains: string
  timeoutMs?: number
  pollIntervalMs?: number
}): Promise<MailtrapMessage> {
  const {
    to,
    subjectContains,
    timeoutMs = 15_000,
    pollIntervalMs = 2_000,
  } = options

  const inboxId = process.env.MAILTRAP_INBOX_ID
  if (!inboxId) throw new Error('MAILTRAP_INBOX_ID nicht in .env.test gesetzt')

  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const messages = await listMessages(inboxId)
    const match = messages.find(m =>
      m.to_email === to &&
      m.subject.toLowerCase().includes(subjectContains.toLowerCase())
    )
    if (match) return match
    await new Promise(r => setTimeout(r, pollIntervalMs))
  }

  throw new Error(
    `E-Mail-Test fehlgeschlagen: Keine E-Mail an "${to}" mit Betreff-Inhalt "${subjectContains}" innerhalb von ${timeoutMs / 1000}s erhalten.`
  )
}

/** Prüft ob eine E-Mail einen bestimmten Text enthält */
export function emailContains(message: MailtrapMessage, text: string): boolean {
  const html = message.html_body?.toLowerCase() ?? ''
  const plain = message.text_body?.toLowerCase() ?? ''
  return html.includes(text.toLowerCase()) || plain.includes(text.toLowerCase())
}
