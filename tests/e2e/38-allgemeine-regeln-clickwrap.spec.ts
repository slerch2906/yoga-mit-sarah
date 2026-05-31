/**
 * Workflow #1 (Sarah-Welle 2026-05-25): Click-Wrap "Allgemeine Regeln" + AGB-Versionierung.
 *
 * Source-Smoke + UI-Flow fuer app/rechtliches/page.tsx:
 *  - 3 Checkboxen (Haftung, AGB, Datenschutz) sind Pflicht
 *  - Scroll-To-End vor Aktivierung (scrolledStep1/scrolledStep2)
 *  - AGB-Versionierung: Re-Acceptance-Modus wenn agb_version < currentOrder
 *  - profiles.agb_version + legal_acceptances.agb_version werden gesetzt
 *  - "Allgemeine Regeln" Abschnitt enthaelt 3 Punkte (Puenktlich, Handy stumm, Krankheit)
 *
 * Lehnt sich an Stil von 14a-account-loeschung-source.spec.ts (read+regex).
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { getServiceClient } from '../utils/db'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

test.describe('[E2E] Click-Wrap Rechtliches — Source-Smoke', () => {
  test('app/rechtliches/page.tsx existiert und hat 2-Schritt-Flow', async () => {
    const src = read('app/rechtliches/page.tsx')
    expect(src).toMatch(/useState<1\s*\|\s*2>\(1\)/)
    expect(src).toMatch(/setStep\(2\)/)
    expect(src).toMatch(/Schritt \{step\} von 2/)
  })

  test('Scroll-To-End-Gating: scrolledStep1 + scrolledStep2 als State', async () => {
    const src = read('app/rechtliches/page.tsx')
    expect(src).toMatch(/scrolledStep1/)
    expect(src).toMatch(/scrolledStep2/)
    // pointer-events-none/opacity-40 als visueller Block bis gescrollt
    expect(src).toMatch(/pointer-events-none/)
  })

  test('Drei Pflicht-Checkboxen: checked1 (Haftung), checked2 (AGB), checked3 (Datenschutz)', async () => {
    const src = read('app/rechtliches/page.tsx')
    expect(src).toMatch(/checked1.*setChecked1/s)
    expect(src).toMatch(/checked2.*setChecked2/s)
    expect(src).toMatch(/checked3.*setChecked3/s)
    // Submit-Button disabled wenn nicht alle 3
    expect(src).toMatch(/!checked2\s*\|\|\s*!checked3/)
    // Haftung-Pflicht in Step 1
    expect(src).toMatch(/disabled=\{!checked1\}/)
  })

  test('Sektion "Allgemeine Regeln" enthaelt 3 Regeln (puenktlich, Handy stumm, krank zu Hause)', async () => {
    const src = read('app/rechtliches/page.tsx')
    expect(src).toMatch(/Allgemeine Regeln/)
    expect(src).toMatch(/pünktlich.*Matte/i)
    expect(src).toMatch(/Handy.*stumm/i)
    expect(src).toMatch(/ansteckend|Erkältung/i)
  })

  test('Stornofrist-Regeln 14d kostenfrei / danach gebucht ist gebucht (volle Kursgebühr)', async () => {
    const src = read('app/rechtliches/page.tsx')
    expect(src).toMatch(/14 Tage.*kostenfrei/)
    expect(src).toMatch(/gebucht ist gebucht/i)
    // alte 30-€-Zwischenstufe ist entfernt (Sarah 2026-05-31)
    expect(src).not.toMatch(/Bearbeitungsgebühr/i)
  })

  test('AGB-Versionierung: ladet getCurrentAgbVersion und vergleicht agb_version', async () => {
    const src = read('app/rechtliches/page.tsx')
    expect(src).toMatch(/getCurrentAgbVersion/)
    expect(src).toMatch(/agb_version/)
    expect(src).toMatch(/sort_order/)
    expect(src).toMatch(/isReAcceptance/)
  })

  test('handleAccept schreibt agb_version + legal_version + legal_acceptances-Row', async () => {
    const src = read('app/rechtliches/page.tsx')
    expect(src).toMatch(/legal_accepted_at:\s*acceptedAt/)
    expect(src).toMatch(/agb_version:\s*targetOrder/)
    expect(src).toMatch(/legal_version:\s*targetLabel/)
    expect(src).toMatch(/from\(['"]legal_acceptances['"]\)\.insert/)
  })

  test('Anonymisierter Account ("Gelöschter") darf nicht akzeptieren', async () => {
    const src = read('app/rechtliches/page.tsx')
    expect(src).toMatch(/first_name === ['"]Gelöschter['"]/)
    expect(src).toMatch(/signOut/)
  })

  test('PDF-Upload via Edge Function agb-drive-upload', async () => {
    const src = read('app/rechtliches/page.tsx')
    expect(src).toMatch(/agb-drive-upload/)
    expect(src).toMatch(/uploadToEdgeFunction/)
    // Welle S1/H8 (Sarah 2026-05-27): Aufruf läuft über server-side API-Route
    // /api/agb-drive-upload mit Bearer-Token. Die Route authentifiziert den Yogi,
    // forwarded dann an die Edge-Function mit Service-Role-Key.
    const apiRoute = read('app/api/agb-drive-upload/route.ts')
    expect(apiRoute).toMatch(/agb-drive-upload/)
    expect(apiRoute).toMatch(/Bearer|auth\.getUser/)
    expect(apiRoute).toMatch(/SERVICE_ROLE_KEY/)
  })

  test('lib/agb-version.ts hat 3 Helper: getCurrentAgbVersion, getAgbVersionByOrder, getAgbChangelogSince', async () => {
    const src = read('lib/agb-version.ts')
    expect(src).toMatch(/export async function getCurrentAgbVersion/)
    expect(src).toMatch(/export async function getAgbVersionByOrder/)
    expect(src).toMatch(/export async function getAgbChangelogSince/)
    // Schema-Felder
    expect(src).toMatch(/sort_order:\s*number/)
    expect(src).toMatch(/changelog:\s*string/)
    expect(src).toMatch(/label:\s*string/)
  })
})

test.describe('[E2E] AGB-Versionierung — DB-Schema', () => {
  test('Tabelle agb_versions existiert und ist SELECT-faehig', async () => {
    const db = getServiceClient()
    const { error } = await db.from('agb_versions').select('id, label, sort_order, changelog').limit(1)
    expect(error?.message || '').toBe('')
  })

  test('profiles.agb_version Spalte existiert', async () => {
    const db = getServiceClient()
    const { error } = await db.from('profiles').select('agb_version').limit(1)
    expect(error?.message || '').toBe('')
  })

  test('legal_acceptances.agb_version Spalte existiert', async () => {
    const db = getServiceClient()
    const { error } = await db.from('legal_acceptances').select('agb_version').limit(1)
    expect(error?.message || '').toBe('')
  })

  test('Mindestens eine AGB-Version vorhanden (sort_order >= 1)', async () => {
    const db = getServiceClient()
    const { data, error } = await db.from('agb_versions')
      .select('id, label, sort_order').order('sort_order', { ascending: false }).limit(1)
    expect(error?.message || '').toBe('')
    expect((data || []).length).toBeGreaterThanOrEqual(1)
    expect((data || [])[0]?.sort_order).toBeGreaterThanOrEqual(1)
  })
})
