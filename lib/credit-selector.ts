/**
 * Smart Credit-Picker für Buchungen.
 *
 * Sarah-Regel 2026-05-22:
 * 1. Course-Credits werden VOR Single/Tenpack/Quartal aufgebraucht (priorisiert).
 * 2. Course-Credits haben Origin-Bindung: jede Vorhol-/Nachhol-Buchung muss mit
 *    der ursprünglich abgesagten Stunde verknüpft sein (bookings.origin_session_id).
 * 3. Window-Check ist MINUTENGENAU:
 *    - Vorholen: session_datetime >= origin_datetime - 10 Tage
 *    - Nachholen: session_datetime <= origin.course.date_end + 8 Tage
 * 4. Wenn Course-Credit-Fenster nicht passt → Fallback auf Single/Tenpack/Quartal.
 * 5. Guthaben (aus Kursabbruch) kann NIE für Einzelstunden/Drop-Ins verwendet werden.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { parseSessionDateTimeBerlin } from './session-time'

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000

export type CreditPickResult =
  | { ok: true; creditId: string; originSessionId: string | null; usedModel: string }
  | { ok: false; reason: 'no_credit' | 'window_blocked'; message: string }

/**
 * Wählt den besten Credit für eine konkrete Session-Buchung.
 *
 * Algorithmus:
 * 1. Lade alle nicht-abgelaufenen Credits des Users.
 * 2. Filter raus: 'guthaben'-Credits (nur für ganze Kurse, nicht für Einzelbuchungen).
 * 3. Course-Credits: pro Credit Origin-Check. Wenn ein passender Anspruch existiert
 *    und das 10d/8d-Fenster zur Session passt → diesen verwenden.
 * 4. Sonst: Fallback auf Single → Tenpack → Quartal (sortiert nach expires_at ASC).
 * 5. Falls course-credit existiert aber Window nicht passt UND keine Fallback-Credits:
 *    Fehlermeldung mit konkretem nächsten Datum.
 */
export async function selectCreditForBooking(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  sessionDate: string,           // YYYY-MM-DD
  sessionTimeStart: string,      // HH:MM[:SS]
): Promise<CreditPickResult> {
  // Berlin-verankert (Zeitzonen-Welle 2): Wandkalender-Zeit korrekt in UTC-Instant.
  // Muss zur Berlin-Verankerung von originDt (Window-Check) konsistent sein, sonst
  // entsteht ein DST-Versatz im 10d/8d-Vergleich. Fallback naiv, falls null.
  const sessionDt = (parseSessionDateTimeBerlin(sessionDate, sessionTimeStart)
    ?? new Date(`${sessionDate}T${sessionTimeStart}`)).getTime()
  const nowIso = new Date().toISOString()
  const sessionIso = new Date(sessionDt).toISOString()

  // Bug-Fix (Sarah 2026-05-28): Zu welchem Kurs gehoert die gebuchte Stunde?
  // Ein Course-Credit darf NUR fuer Stunden des EIGENEN Kurses verwendet werden.
  // Vorher konnte z.B. eine Body&Mind-Buchung den Credit eines voellig anderen
  // Kurses ("Credit Hinweis Ablauf") verbrauchen, wenn dessen Nachhol-Fenster
  // zufaellig passte. Wir laden die course_id der Ziel-Session und filtern
  // Course-Credits strikt darauf.
  const { data: targetSession } = await supabase.from('sessions')
    .select('course_id').eq('id', sessionId).maybeSingle()
  const sessionCourseId = (targetSession as any)?.course_id || null

  // Sarah-Regel 2026-05-22: Credit muss minutengenau bis zum SESSION-Zeitpunkt
  // gültig sein, nicht nur bis jetzt. Sonst könnte ein Yogi heute eine Stunde
  // in 3 Wochen buchen mit einem Credit, der in 5 Tagen abläuft → Buchung ohne
  // Deckung. Wir laden also nur Credits deren expires_at > sessionDt.
  const { data: allCredits } = await supabase.from('credits')
    .select('*').eq('user_id', userId)
    .gt('expires_at', sessionIso)

  // Plus separat: prüfen ob der Yogi überhaupt aktuell GÜLTIGE Credits hat
  // (um zwischen "kein Credit" vs. "Credit läuft vorher ab" unterscheiden zu können)
  const { data: currentCredits } = await supabase.from('credits')
    .select('id, model, total, used, expires_at').eq('user_id', userId)
    .gt('expires_at', nowIso)

  // Sarah-Wunsch 2026-05-25: Credits mit valid_from in der Zukunft
  // sind noch nicht nutzbar (z.B. Quartal-Abo für nächstes Quartal).
  // Wir vergleichen valid_from mit dem SESSION-Datum: Credit ist gültig
  // wenn er bis zur Session-Zeit aktiviert wurde.
  const sessionDateOnly = sessionDate // YYYY-MM-DD
  const candidates = (allCredits || []).filter((c: any) =>
    c.total > c.used
    && c.model !== 'guthaben'
    && (!c.valid_from || c.valid_from <= sessionDateOnly)
  )
  if (candidates.length === 0) {
    // Spezifischere Meldung: Credit existiert, läuft aber vor der Session ab
    const expiringSoon = (currentCredits || []).filter((c: any) =>
      c.total > c.used && c.model !== 'guthaben'
    )
    if (expiringSoon.length > 0) {
      // Bug-Fix (Sarah 2026-05-28): Kurs-Credits laufen exakt 8 Tage nach
      // Kursende ab. Wenn der einzige verfuegbare Credit ein abgelaufener
      // Kurs-Credit ist, ist die Stunde >8 Tage nach Kursende → Sarahs
      // Wunsch-Meldung statt des generischen Ablauf-Textes.
      const hasCourseCredit = expiringSoon.some((c: any) => c.model === 'course')
      if (hasCourseCredit) {
        return {
          ok: false, reason: 'window_blocked',
          message: 'Credits sind nur einzulösen bis 8 Tage nach Kursende. Diese Stunde liegt außerhalb dieses Zeitraums.',
        }
      }
      // Frühestes Ablaufdatum unter den freien Credits
      const earliest = expiringSoon
        .map((c: any) => new Date(c.expires_at).getTime())
        .sort((a, b) => a - b)[0]
      const dStr = new Date(earliest).toLocaleDateString('de-DE', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin'
      })
      return {
        ok: false, reason: 'no_credit',
        message: `Dein Credit läuft am ${dStr} ab und ist für diese Stunde nicht mehr gültig.`,
      }
    }
    return { ok: false, reason: 'no_credit', message: 'Du hast keinen freien Credit für diese Buchung.' }
  }

  // 1) Course-Credits zuerst — mit KURS-VORRANG.
  // Bug-Fix (Sarah 2026-05-28): Gehoert die gebuchte Stunde zu Kurs X, wird
  // ZUERST der Course-Credit von Kurs X probiert, erst danach Credits anderer
  // Kurse (damit das Nachholen einer abgesagten Stunde in einer anderen Stunde
  // weiterhin moeglich bleibt). Vorher wurde rein nach expires_at sortiert →
  // eine Body&Mind-Buchung konnte faelschlich den "Credit Hinweis Ablauf"-
  // Credit verbrauchen, obwohl ein eigener Body&Mind-Credit frei war.
  // Innerhalb gleicher Kurs-Zugehoerigkeit weiter aelteste-Ablauf-zuerst.
  const courseCredits = candidates.filter((c: any) => c.model === 'course')
    .sort((a: any, b: any) => {
      const aOwn = sessionCourseId != null && a.course_id === sessionCourseId ? 0 : 1
      const bOwn = sessionCourseId != null && b.course_id === sessionCourseId ? 0 : 1
      if (aOwn !== bOwn) return aOwn - bOwn  // eigener Kurs zuerst
      return new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime()
    })

  let courseWindowBlockedMessage: string | null = null

  for (const cc of courseCredits) {
    const pick = await tryCourseCredit(supabase, userId, sessionId, sessionDt, cc)
    if (pick.ok) return pick
    if (pick.reason === 'window_blocked' && !courseWindowBlockedMessage) {
      courseWindowBlockedMessage = pick.message
    }
    // 'no_origin' → kein Anspruch zu vergeben mit diesem Credit, weiter zur nächsten Option
  }

  // 2) Fallback: andere Credits (single/tenpack/quartal)
  const otherCredits = candidates.filter((c: any) => c.model !== 'course')
    .sort((a: any, b: any) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())

  if (otherCredits.length > 0) {
    const c = otherCredits[0]
    return { ok: true, creditId: c.id, originSessionId: null, usedModel: c.model }
  }

  // 3) Nichts gefunden
  if (courseWindowBlockedMessage) {
    return { ok: false, reason: 'window_blocked', message: courseWindowBlockedMessage }
  }
  return { ok: false, reason: 'no_credit', message: 'Du hast keinen freien Credit für diese Buchung.' }
}

/**
 * Probiert einen konkreten Course-Credit zu verwenden.
 * Returns:
 *  - ok=true mit creditId + originSessionId wenn ein passender Anspruch im Window liegt
 *  - reason='no_origin' wenn kein verbleibender Anspruch zu vergeben ist (z.B. weil alle
 *    cancelled bookings dieses Credits schon durch Vorholbuchungen verbraucht sind)
 *  - reason='window_blocked' wenn ein Anspruch da ist, aber die Session außerhalb des Fensters liegt
 */
async function tryCourseCredit(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  sessionDt: number,
  courseCredit: any,
): Promise<CreditPickResult | { ok: false; reason: 'no_origin'; message: string }> {
  // Alle cancelled bookings des Users die mit DIESEM Course-Credit verknüpft sind.
  // Plus session-Daten + course.date_end für Nachhol-Window.
  const { data: cancelled } = await supabase.from('bookings')
    .select('id, session_id, session:sessions!bookings_session_id_fkey(id, date, time_start, course:courses(date_end))')
    .eq('user_id', userId)
    .eq('credit_id', courseCredit.id)
    .eq('status', 'cancelled')
  const cancelledSorted = ((cancelled || []) as any[])
    .filter(b => b.session?.date && b.session?.time_start)
    .sort((a: any, b: any) => {
      // Berlin-verankert (Zeitzonen-Welle 2). null → ans Ende sortieren (Infinity).
      const ad = parseSessionDateTimeBerlin(a.session.date, a.session.time_start)?.getTime() ?? Number.POSITIVE_INFINITY
      const bd = parseSessionDateTimeBerlin(b.session.date, b.session.time_start)?.getTime() ?? Number.POSITIVE_INFINITY
      return ad - bd
    })

  if (cancelledSorted.length === 0) {
    return { ok: false, reason: 'no_origin', message: 'Kein freier Anspruch' }
  }

  // Bug-Fix (Sarah 2026-05-28): Wiederanmeldung zur EXAKT abgesagten Stunde ist
  // eine simple Reaktivierung — KEIN Vorholen/Nachholen. Der freigewordene
  // Course-Credit gehört genau zu dieser Stunde, also ist die Buchung immer
  // erlaubt: kein Origin-Anspruch, keine 10d/8d-Fensterprüfung nötig.
  // Vorher wurde diese Stunde in der Schleife übersprungen ("continue") → war sie
  // der einzige Anspruch dieses Credits, fiel der Picker fälschlich auf
  // "Du hast keinen freien Credit", obwohl der Yogi sichtbar 1 freien Credit hatte
  // (genau den, den er sich durch die Abmeldung gerade selbst freigemacht hat).
  if (cancelledSorted.some((cb: any) => cb.session?.id === sessionId)) {
    return { ok: true, creditId: courseCredit.id, originSessionId: null, usedModel: 'course' }
  }

  // Bereits verbrauchte Origins (durch existierende active Vorholbuchungen)
  const { data: claimedRows } = await supabase.from('bookings')
    .select('origin_session_id')
    .eq('user_id', userId).eq('status', 'active')
    .not('origin_session_id', 'is', null)
  const claimedIds = new Set((claimedRows || []).map((r: any) => r.origin_session_id))

  // Vereinheitlichtes Window pro Origin: [origin - 10d, courseEnd + 8d]
  // - Untergrenze: max 10 Tage vor abgesagter Stunde ("Vorholen")
  // - Obergrenze: 8 Tage nach Kursende ("Nachholen")
  // - Buchungen ZWISCHEN Origin und Kursende sind problemlos erlaubt (kein extra Check)
  //   Beispiel: Origin am 28.5., heute 22.5., neue Buchung am 1.6. → erlaubt, weil 1.6.
  //   im Window [18.5., Kursende+8d] liegt.
  // Frühest-mögliche STUNDE (windowStart) + zugehöriges Origin-Datum für die User-Message.
  // Wichtig: das ist NICHT "ab wann darf der Yogi BUCHEN" sondern "welche Stunde
  // darf frühestens gebucht werden". Buchen kann er jederzeit — nur die zu buchende
  // Stunde darf nicht weiter als 10 Tage vor seiner abgesagten Stunde liegen.
  let nextValidDt: number | null = null
  let nextValidOriginDt: number | null = null
  let nachholBlocked = false  // mind. eine Origin: Stunde liegt NACH Kursende+8d
  const now = Date.now()
  for (const cb of cancelledSorted) {
    if (claimedIds.has(cb.session.id)) continue
    // (Reaktivierung der gleichen Stunde ist oben bereits abgehandelt.)

    // Berlin-verankert (Zeitzonen-Welle 2). cancelledSorted ist bereits auf
    // date+time_start vorgefiltert (siehe oben), daher kein null-Fall hier;
    // dennoch defensiv naiv defaulten.
    const originDt = (parseSessionDateTimeBerlin(cb.session.date, cb.session.time_start)
      ?? new Date(`${cb.session.date}T${cb.session.time_start}`)).getTime()
    const windowStart = originDt - TEN_DAYS_MS
    const courseEnd = cb.session.course?.date_end
    const windowEnd = courseEnd
      ? new Date(`${courseEnd}T23:59:59`).getTime() + EIGHT_DAYS_MS
      : Number.POSITIVE_INFINITY

    if (sessionDt < windowStart) {
      // Zu früh — Stunde liegt VOR dem 10d-Fenster dieser Origin.
      if (nextValidDt === null || windowStart < nextValidDt) {
        nextValidDt = windowStart
        nextValidOriginDt = originDt
      }
      continue
    }
    if (sessionDt > windowEnd) {
      // Zu spät — diese Origin verfällt nach Kursende+8d. Andere Origin probieren.
      nachholBlocked = true
      continue
    }
    // Valid — diese Origin verwenden
    return { ok: true, creditId: courseCredit.id, originSessionId: cb.session.id, usedModel: 'course' }
  }

  // Bug-Fix (Sarah 2026-05-28): Wenn eine Origin existierte, aber die gebuchte
  // Stunde NACH Kursende+8d liegt (und keine fruehere Vorhol-Grenze griff),
  // klare Nachhol-Meldung statt stillem Durchfallen.
  if (nachholBlocked && nextValidDt === null) {
    return {
      ok: false, reason: 'window_blocked',
      message: 'Credits sind nur einzulösen bis 8 Tage nach Kursende. Diese Stunde liegt außerhalb dieses Zeitraums.',
    }
  }

  // Kein verfügbarer Anspruch passt → window_blocked Message
  // Aber nur wenn nextValidDt wirklich in der ZUKUNFT liegt (sonst irreführend).
  if (nextValidDt !== null && nextValidDt > now) {
    const fmtFull = (ms: number) => new Date(ms).toLocaleString('de-DE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/Berlin'
    })
    const fmtDay = (ms: number) => new Date(ms).toLocaleString('de-DE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      timeZone: 'Europe/Berlin'
    })
    const originStr = nextValidOriginDt ? fmtFull(nextValidOriginDt) : '(unbekannt)'
    const earliestStr = fmtDay(nextValidDt)
    return {
      ok: false,
      reason: 'window_blocked',
      message:
        `Du kannst eine Stunde aus deinem Kurs vorziehen, aber sie darf maximal 10 Tage ` +
        `vor deiner abgesagten Stunde liegen.\n\n` +
        `Deine nächste abgesagte Stunde: ${originStr}\n` +
        `Frühestens buchbar sind Stunden ab: ${earliestStr}`,
    }
  }
  // Es gab Origins, aber keine passte (z.B. alle bereits verbraucht oder Nachhol-Fenster vorbei)
  return { ok: false, reason: 'no_origin', message: 'Kein freier Anspruch' }
}
