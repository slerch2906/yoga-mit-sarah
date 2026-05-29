/**
 * Welle S3/Pattern 3 (Sarah 2026-05-27): Defensive Date-Parsing-Helper.
 *
 * Bisher wurde an vielen Stellen `new Date(`${session.date}T${session.time_start}`)`
 * geschrieben. Wenn date oder time_start null sind (z.B. bei kaputten DB-Zeilen
 * oder fehlerhaften Joins), produziert das ein Invalid Date — und nachfolgende
 * Vergleiche (`< new Date()`, `.getTime()`) liefern NaN oder undefined.
 *
 * Dieser Helper liefert NULL statt eines Invalid Date. Caller sollten dann
 * konservativ defaulten (z.B. "nicht past, nicht within3h").
 */

export function parseSessionDateTime(
  date: string | null | undefined,
  time: string | null | undefined,
): Date | null {
  if (!date || !time) return null
  try {
    const dt = new Date(`${date}T${time}`)
    return isNaN(dt.getTime()) ? null : dt
  } catch {
    return null
  }
}

/**
 * Welle Fall-5 (Sarah 2026-05-29): Berlin-verankertes Date-Parsing.
 *
 * Stunden-Zeiten (date + time_start) sind IMMER deutsche Wandkalender-Zeit
 * (Europe/Berlin). `new Date(`${date}T${time}`)` interpretiert den String aber
 * in der BROWSER-Zeitzone. Sitzt der Yogi im Urlaub in einer anderen Zeitzone,
 * wird der absolute Start-Zeitpunkt falsch berechnet — und damit auch die harten
 * Abmeldefristen (3 h / 7 Tage / 90 Min).
 *
 * Dieser Helper liefert den KORREKTEN absoluten Zeitpunkt (UTC-Instant), der der
 * deutschen Wandkalender-Zeit entspricht — unabhängig von der Browser-Zeitzone.
 * Sommer-/Winterzeit (CEST/CET) wird automatisch korrekt berücksichtigt.
 *
 * Liefert NULL bei fehlenden/kaputten Werten (Caller defaulten konservativ).
 */
export function parseSessionDateTimeBerlin(
  date: string | null | undefined,
  time: string | null | undefined,
): Date | null {
  if (!date || !time) return null
  try {
    const [y, mo, d] = date.split('-').map(Number)
    const tp = time.split(':').map(Number)
    const h = tp[0] || 0, mi = tp[1] || 0, s = tp[2] || 0
    if (!y || !mo || !d || isNaN(h) || isNaN(mi)) return null
    // Naive UTC-Interpretation der Wandkalender-Zeit
    const naiveUTC = Date.UTC(y, mo - 1, d, h, mi, s)
    // Berlin-Offset für genau diesen Zeitpunkt bestimmen (CEST/CET-sicher)
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
    const parts: Record<string, string> = {}
    for (const p of dtf.formatToParts(new Date(naiveUTC))) parts[p.type] = p.value
    const hourPart = parts.hour === '24' ? 0 : Number(parts.hour)
    const asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      hourPart, Number(parts.minute), Number(parts.second),
    )
    const offsetMs = asUTC - naiveUTC
    const instant = new Date(naiveUTC - offsetMs)
    return isNaN(instant.getTime()) ? null : instant
  } catch {
    return null
  }
}
