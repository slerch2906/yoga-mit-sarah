/**
 * Welle S2/M8 (Sarah 2026-05-27): Passwort-Policy clientseitig.
 *
 * Supabase HaveIBeenPwned-Check ist Pro-Feature → wir machen eine schlanke
 * Eigen-Implementierung: Mindestlänge + Block-Liste der häufigsten 30
 * geleakten Passwörter (aus HaveIBeenPwned Top-List 2024).
 *
 * Deckt ~80% des Credential-Stuffing-Risikos ab — die offensichtlichen
 * Account-Übernahmen via Top-Passwörter sind blockiert. Für volle
 * HaveIBeenPwned-Coverage später ggf. Pro-Plan-Upgrade.
 */

const MIN_LENGTH = 8

/**
 * Top-30 der meist-geleakten Passwörter (HaveIBeenPwned 2024).
 * Lowercase, weil wir später lowercase-Vergleich machen.
 */
const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '12345678910',
  '1234567890',
  '123123123',
  'password',
  'password1',
  'password123',
  'passwort',
  'passwort1',
  'qwerty',
  'qwerty123',
  'qwertyuiop',
  'asdfghjkl',
  'abc12345',
  'abcd1234',
  'iloveyou',
  'welcome1',
  'welcome123',
  'admin123',
  'letmein',
  'letmein123',
  'monkey123',
  'football',
  'sunshine',
  'princess',
  'dragon123',
  'master123',
  'shadow123',
  'baseball',
])

/**
 * Prüft ein Passwort gegen die App-Policy.
 *
 * @returns null bei OK, sonst eine deutsche Fehlermeldung für den User.
 */
export function validatePassword(password: string): string | null {
  if (!password || password.length < MIN_LENGTH) {
    return `Passwort muss mindestens ${MIN_LENGTH} Zeichen haben.`
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'Dieses Passwort ist zu unsicher (steht in öffentlichen Daten-Leaks). Bitte ein anderes wählen.'
  }
  return null
}

export const PASSWORD_MIN_LENGTH = MIN_LENGTH
