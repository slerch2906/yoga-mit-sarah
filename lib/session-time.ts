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
