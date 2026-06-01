/**
 * DSGVO-Loeschung: Admin-Info-Mail + Benachrichtigung server-seitig (Sarah 2026-06-01)
 *
 * Bug: Loescht ein Yogi sich SELBST, bekam Sarah keine Admin-Info-Mail. Ursache: die
 * Loesch-Nebenwirkungen (Yogi-Mail, Admin-Mail, admin_notifications-Insert) liefen
 * clientseitig als Yogi — der admin_notifications-Insert scheiterte still an der
 * "Admin only"-RLS, und der Rest brach durch Logout/Navigation ab.
 *
 * Fix: /api/delete-account (Service-Rolle, RLS-immun) macht das jetzt server-seitig —
 * fuer BEIDE Loesch-Wege. Diese Source-Checks sichern den Fix gegen Regression ab.
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

test.describe('DSGVO-Loeschung: server-seitige Admin-Info', () => {
  test('Route /api/delete-account versendet Yogi-Mail, Admin-Mail UND Admin-Benachrichtigung', () => {
    const route = read('app/api/delete-account/route.ts')
    expect(route, 'Yogi-Bestaetigungsmail server-seitig').toMatch(/accountDeletedYogi/)
    expect(route, 'Admin-Info-Mail server-seitig').toMatch(/adminDsgvoDeletion/)
    expect(route, 'Admin-Benachrichtigung server-seitig').toMatch(/account_deleted_dsgvo/)
  })

  test('Selbst-Loeschung uebergibt Daten an die Route und macht KEINE eigene Admin-Mail/-Benachrichtigung', () => {
    const profil = read('app/profil/page.tsx')
    expect(profil, 'email + fullName + firstName an die Route').toMatch(/email,\s*fullName,\s*firstName/)
    // Nicht mehr clientseitig (scheiterte an RLS / brach ab):
    expect(profil, 'kein clientseitiger admin-Mail-Aufruf mehr').not.toMatch(/adminDsgvoDeletion/)
    expect(profil, 'kein clientseitiger admin_notifications-Insert mehr').not.toMatch(/account_deleted_dsgvo/)
  })

  test('Admin-Loeschung uebergibt ebenfalls Daten an die Route (kein Doppel-Versand)', () => {
    const adminDel = read('app/admin/yogis/[id]/page.tsx')
    expect(adminDel, 'email + fullName + firstName an die Route').toMatch(/email,\s*fullName,\s*firstName/)
    expect(adminDel, 'kein clientseitiger adminDsgvoDeletion-Aufruf mehr').not.toMatch(/adminDsgvoDeletion/)
  })
})
