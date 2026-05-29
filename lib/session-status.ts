/**
 * Kanonische Status-Logik für Sessions.
 *
 * Status-Modell (Single Source of Truth):
 *
 * | Status            | DB-Bedingung                                          | Zählt als Einheit | Credit-relevant |
 * |-------------------|-------------------------------------------------------|-------------------|------------------|
 * | Aktiv             | is_cancelled=false                                    | JA                | JA               |
 * | Vergangen         | aktiv UND date+time_start < now                       | JA                | JA (verbraucht)  |
 * | Ausgeschlossen    | is_cancelled=true UND cancel_reason='excluded'        | NEIN              | NEIN             |
 * | Abgesagt          | is_cancelled=true UND cancel_reason!='excluded'       | NEIN              | NEIN (Refund/Ersatz) |
 *
 * WICHTIG: Bei jeder Session-Query mindestens `is_cancelled` UND `cancel_reason`
 * mitladen, sonst kann hier nicht korrekt unterschieden werden.
 */

export type SessionLike = {
  id?: string
  date?: string | null
  time_start?: string | null
  duration_min?: number | null
  is_cancelled?: boolean | null
  cancel_reason?: string | null
}

/** Stunde wurde bei Kurs-Setup ausgeschlossen (Ferien etc.) — zählt nicht als Einheit. */
export function isExcluded(s: SessionLike | null | undefined): boolean {
  return !!s?.is_cancelled && s?.cancel_reason === 'excluded'
}

/** Stunde wurde live abgesagt (vom Admin) — Credit muss zurück oder per Ersatz neu eingebucht. */
export function isCancelled(s: SessionLike | null | undefined): boolean {
  return !!s?.is_cancelled && s?.cancel_reason !== 'excluded'
}

/** Stunde findet (noch) statt — entweder zukünftig oder gerade laufend. */
export function isActive(s: SessionLike | null | undefined): boolean {
  return s != null && s.is_cancelled !== true
}

/** Stunde hat begonnen (gilt als „Teilgenommen"). Stundenstart ist der Cutoff. */
export function isStarted(s: SessionLike | null | undefined): boolean {
  if (!s?.date || !s?.time_start) return false
  return new Date(`${s.date}T${s.time_start}`) < new Date()
}

/** Stunde liegt zeitlich in der Vergangenheit (ganzer Tag-Check, ignoriert Status). */
export function isPastDay(s: SessionLike | null | undefined): boolean {
  if (!s?.date) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(s.date) < today
}

/**
 * Anzahl Sessions die als „Einheit" zählen (= aktive Sessions).
 * Quelle der Wahrheit für Credit-Vergabe.
 */
export function countActiveUnits(sessions: SessionLike[] | null | undefined): number {
  return (sessions || []).filter(isActive).length
}

/**
 * Wie countActiveUnits, aber nur zukünftige/laufende Sessions (date >= heute).
 * Genutzt fürs Einbuchen — vergangene Sessions kann man nicht mehr buchen.
 */
export function countActiveFutureUnits(sessions: SessionLike[] | null | undefined): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return (sessions || []).filter(s => isActive(s) && s.date && new Date(s.date) >= today).length
}

export type CourseLike = {
  date_end?: string | null   // YYYY-MM-DD letzte (geplante) Kursstunde
  time_start?: string | null // HH:MM[:SS] wöchentlicher Slot
}

/**
 * Kurs gilt als BEENDET in der Minute, in der die LETZTE Stunde BEGONNEN hat.
 *
 * Sarah-Regel 2026-05-28: NICHT erst am Tagesende von date_end, sondern exakt
 * ab date_end + course.time_start. course.time_start ist der wöchentliche
 * Slot — die letzte Stunde liegt auf date_end zu genau dieser Uhrzeit.
 * Fehlt time_start, fällt der Cutoff auf Tagesende (23:59:59) zurück.
 *
 * @param refNow optional injizierbare „Jetzt"-Zeit für Tests
 */
export function isCourseEnded(course: CourseLike | null | undefined, refNow?: Date): boolean {
  if (!course?.date_end) return false
  const t = course.time_start || '23:59:59'
  const endDt = new Date(`${course.date_end}T${t}`)
  return endDt < (refNow || new Date())
}

/** Status-Label für die UI. */
export function sessionStatusLabel(s: SessionLike | null | undefined):
  | 'Aktiv' | 'Vergangen' | 'Ausgeschlossen' | 'Abgesagt' {
  if (isExcluded(s)) return 'Ausgeschlossen'
  if (isCancelled(s)) return 'Abgesagt'
  if (isStarted(s)) return 'Vergangen'
  return 'Aktiv'
}

/** Buchung mit Status + (seit 2026-05-29) Akteur einer Stornierung. */
export type BookingLike = {
  status?: string | null
  cancelled_by?: string | null
}

/**
 * Akteur-Wort für eine STORNIERTE Buchung (Sarah-Regel 2026-05-29):
 *   'admin'     → 'Ausgetragen'  (Sarah/Admin hat den Yogi herausgenommen)
 *   'self'/NULL → 'Abgemeldet'   (Yogi selbst; NULL = Altbestand ohne Herkunft)
 *
 * WICHTIG: Eine Session-Absage (isCancelled) hat in der Anzeige IMMER Vorrang
 * ('Abgesagt') und wird VOR diesem Helfer geprüft — siehe bookingStatusLabel.
 */
export function cancelledActorLabel(
  booking: BookingLike | null | undefined,
): 'Ausgetragen' | 'Abgemeldet' {
  return booking?.cancelled_by === 'admin' ? 'Ausgetragen' : 'Abgemeldet'
}

/**
 * Vollständiges Status-Wort einer Buchung in einer Session.
 * Reihenfolge (Vorrang von oben nach unten):
 *   1. Session ausgeschlossen           → 'Ausgeschlossen'
 *   2. Session abgesagt                 → 'Abgesagt'
 *   3. Buchung storniert (Akteur!)      → 'Ausgetragen' | 'Abgemeldet'
 *   4. Buchung aktiv & Stunde gestartet → 'Teilgenommen'
 *   5. Buchung aktiv & zukünftig        → null
 *      (Aufrufer rendert 'Angemeldet' bzw. 'Eingebucht')
 *
 * Fehlende Buchung (null) wird wie 'storniert' behandelt → 'Abgemeldet'
 * (entspricht der bisherigen /meine-Logik: `!mb || status==='cancelled'`).
 */
export function bookingStatusLabel(
  session: SessionLike | null | undefined,
  booking: BookingLike | null | undefined,
):
  | 'Ausgeschlossen' | 'Abgesagt' | 'Ausgetragen' | 'Abgemeldet' | 'Teilgenommen' | null {
  if (isExcluded(session)) return 'Ausgeschlossen'
  if (isCancelled(session)) return 'Abgesagt'
  if (!booking || booking.status === 'cancelled') return cancelledActorLabel(booking)
  if (isStarted(session)) return 'Teilgenommen'
  return null
}
