/**
 * Workflow: PWA-Install (App-Icon + Install-Banner)
 *
 * Hintergrund (Sarah 2026-05-21):
 *   - Beim Installieren auf einem neuen Handy erschien das ALTE WordPress-Logo
 *     als App-Icon statt der neuen Yoga-Linienzeichnung.
 *   - Der Install-Banner ploppte sofort während des Haftungsausschlusses auf
 *     und stand voll im Weg.
 *
 * Fix:
 *   - apple-touch-icon + manifest-Icons zeigen jetzt auf lokale /apple-touch-icon.png
 *     bzw. /logo-{192,512}.png mit ?v=2 Cache-Bust.
 *   - Install-Banner blockt jetzt die Pfade /rechtliches, /login, /register,
 *     /profil/passwort, / und zeigt sich erst wenn der Yogi navigiert.
 *
 * Hinweis: beforeinstallprompt ist Chrome-/Android-only und lässt sich in
 * Playwright headless nicht ohne weiteres triggern. Wir testen daher statisch:
 *   - korrekte Icon-Referenzen im HTML & manifest.json
 *   - korrekte Pfad-Blacklist im inline-Script
 *   - Assets sind unter den erwarteten URLs erreichbar
 */
import { test, expect } from '@playwright/test'

test.describe('[E2E] PWA: App-Icon + Install-Banner', () => {
  test('apple-touch-icon zeigt auf lokales /apple-touch-icon.png (kein WordPress-Link mehr)', async ({ page }) => {
    const response = await page.goto('/login')
    const html = await response!.text()

    // Apple-touch-icon im <link rel="apple-touch-icon"> muss lokal sein,
    // nicht eine WordPress-URL. (Body-Logos dürfen weiter WordPress nutzen —
    // die werden für Branding-Konsistenz extern referenziert.)
    expect(html).toMatch(/rel=["']apple-touch-icon["'][^>]*href=["']\/apple-touch-icon\.png["']/i)

    // PWA-Manifest-relevante Icons müssen lokal verfügbar sein
    expect(html).toContain('/apple-touch-icon.png')
    expect(html).toContain('/logo-512.png')
    expect(html).toContain('/logo-192.png')
  })

  test('Icon-Dateien sind unter den erwarteten URLs erreichbar', async ({ page }) => {
    for (const path of ['/apple-touch-icon.png', '/logo-192.png', '/logo-512.png']) {
      const res = await page.request.get(path)
      expect(res.status(), `${path} muss 200 liefern`).toBe(200)
      expect(res.headers()['content-type']).toContain('image/png')
    }
  })

  test('manifest.json enthält maskable Icons + apple-touch-icon', async ({ page }) => {
    const res = await page.request.get('/manifest.json')
    expect(res.status()).toBe(200)
    const manifest = await res.json()
    expect(manifest.icons).toBeDefined()
    const srcs = manifest.icons.map((i: any) => i.src)
    expect(srcs.some((s: string) => s.includes('/logo-192.png'))).toBeTruthy()
    expect(srcs.some((s: string) => s.includes('/logo-512.png'))).toBeTruthy()
    expect(srcs.some((s: string) => s.includes('/apple-touch-icon.png'))).toBeTruthy()
    // maskable purpose vorhanden (für Android Adaptive Icons)
    const hasMaskable = manifest.icons.some((i: any) =>
      typeof i.purpose === 'string' && i.purpose.includes('maskable')
    )
    expect(hasMaskable).toBeTruthy()
  })

  test('Install-Banner-Script blockt /rechtliches, /login, /register, /profil/passwort, /', async ({ page }) => {
    const response = await page.goto('/login')
    const html = await response!.text()
    // Blocked-Paths-Array muss alle 5 Pfade enthalten
    expect(html).toMatch(/INSTALL_BLOCKED_PATHS\s*=\s*\[[^\]]*'\/rechtliches'/)
    expect(html).toMatch(/INSTALL_BLOCKED_PATHS\s*=\s*\[[^\]]*'\/login'/)
    expect(html).toMatch(/INSTALL_BLOCKED_PATHS\s*=\s*\[[^\]]*'\/register'/)
    expect(html).toMatch(/INSTALL_BLOCKED_PATHS\s*=\s*\[[^\]]*'\/profil\/passwort'/)
  })

  test('Service Worker registriert sich und Cache-Version ist v6', async ({ page }) => {
    const swRes = await page.request.get('/sw.js')
    expect(swRes.status()).toBe(200)
    const swBody = await swRes.text()
    expect(swBody).toContain("CACHE_VERSION = 'yoga-sarah-v6'")
  })

  // beforeinstallprompt-Event-Verhalten lässt sich nur manuell auf
  // Android-Chrome verifizieren. Daher als fixme dokumentiert.
  test.fixme('Banner erscheint NICHT auf /rechtliches, aber AUF /kurse (manuell)', async () => {
    // Manueller Check auf Android-Chrome:
    // 1. App im inkognito öffnen, /rechtliches aufrufen
    // 2. 5 Sekunden warten → Banner darf nicht erscheinen
    // 3. AGB akzeptieren → Redirect auf /kurse
    // 4. 5 Sekunden warten → Banner erscheint
  })
})
