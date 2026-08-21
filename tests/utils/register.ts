/**
 * Helfer fuer Browser-Registrierungstests.
 *
 * Hintergrund (2026-08-21): Eine echte Registrierung ueber die UI loest bei
 * Supabase Auth eine Bestaetigungs-Mail aus. Auf Staging laeuft das ueber den
 * eingebauten Supabase-Mailversand, der nur eine Handvoll Mails pro Stunde
 * zulaesst. Beim Durchlauf der kompletten Suite registrieren sich mehrere
 * Tests hintereinander — ab der zweiten/dritten Registrierung antwortet Supabase
 * mit "email rate limit exceeded", die Seite bleibt stehen und der Test lief in
 * einen Timeout. Das sah wie ein App-Fehler aus, ist aber ein Infrastruktur-
 * Limit der Staging-Umgebung.
 *
 * Damit die Suite ehrlich bleibt, wird hier unterschieden:
 *   - Weiterleitung kommt  -> Test laeuft normal weiter.
 *   - Rate-Limit-Banner    -> Test wird uebersprungen (mit klarem Grund).
 *   - nichts von beidem    -> echter Fehler, Timeout wie bisher.
 *
 * Dauerhafte Abhilfe waere, in den Staging-Auth-Einstellungen die
 * E-Mail-Bestaetigung abzuschalten; dann verschickt signUp keine Mail mehr.
 */
import { Page, test } from '@playwright/test'

const RATE_LIMIT_TEXT = /email rate limit exceeded|rate limit/i

/**
 * Wartet nach dem Absenden des Registrierungsformulars auf die Weiterleitung
 * zu /rechtliches. Kommt stattdessen das Supabase-Rate-Limit, wird der Test
 * uebersprungen statt fehlzuschlagen.
 */
export async function waitForRegistrationRedirect(page: Page, timeoutMs = 30_000) {
  const redirect = page.waitForURL(/\/rechtliches/, { timeout: timeoutMs }).then(() => 'ok' as const)
  const rateLimit = page
    .getByText(RATE_LIMIT_TEXT)
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => 'rate-limit' as const)

  // Beide Zweige laufen parallel; der Verlierer darf still scheitern.
  const outcome = await Promise.race([
    redirect.catch(() => 'timeout' as const),
    rateLimit.catch(() => 'timeout' as const),
  ])

  if (outcome === 'rate-limit') {
    test.skip(
      true,
      'Supabase-Mail-Limit auf Staging erreicht (email rate limit exceeded) — ' +
        'Registrierung liess sich nicht durchfuehren. Kein App-Fehler.'
    )
  }

  // Kein Rate-Limit: auf die Weiterleitung bestehen (wirft bei echtem Fehler).
  await page.waitForURL(/\/rechtliches/, { timeout: timeoutMs })
}
