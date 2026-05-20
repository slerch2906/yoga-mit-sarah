/**
 * Liefert die Server-Zeit (UTC) für Frist-Berechnungen.
 * Verhindert dass User mit falsch eingestellter Browser-Uhr
 * an Stornofristen vorbeibuchen.
 *
 * Strategie: Per HTTP-Header-Date vom Supabase-Server holen.
 * Fallback: Browser-Zeit (besser als gar nichts).
 */
let cachedOffset: number | null = null
let lastCheck = 0

export async function getServerNow(): Promise<Date> {
  // Cache 5 Minuten gültig
  if (cachedOffset !== null && Date.now() - lastCheck < 5 * 60 * 1000) {
    return new Date(Date.now() + cachedOffset)
  }

  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`,
      { method: 'HEAD', cache: 'no-store' }
    )
    const serverDate = res.headers.get('date')
    if (serverDate) {
      const serverMs = new Date(serverDate).getTime()
      const localMs = Date.now()
      cachedOffset = serverMs - localMs
      lastCheck = Date.now()
      return new Date(serverMs)
    }
  } catch {
    // Network error - fallback to browser time
  }

  return new Date()
}

/**
 * Prüft ob eine Frist (z.B. 3h vor Stunde) bereits abgelaufen ist.
 * Nutzt Server-Zeit damit User mit verstellter Uhr nicht tricksen können.
 */
export async function isPastDeadline(sessionDate: string, sessionTimeStart: string, hoursBeforeAllowed: number): Promise<boolean> {
  const now = await getServerNow()
  const sessionStart = new Date(`${sessionDate}T${sessionTimeStart}`)
  const deadline = new Date(sessionStart.getTime() - hoursBeforeAllowed * 60 * 60 * 1000)
  return now > deadline
}
