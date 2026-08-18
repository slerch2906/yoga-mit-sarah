/**
 * Bugfix (Sarah 2026-08-18): Die 8-Tage-Nachholfrist für Kurs-Credits soll den
 * GANZEN 8. Tag gelten, nicht nur bis zu einer bestimmten Uhrzeit.
 *
 * Reproduktion des gemeldeten Bugs: letzte Kursstunde Dienstag 18:00 Uhr. Ein
 * Yogi will die Stunde am darauffolgenden Mittwoch 18:30 Uhr nachholen (= Tag 8
 * nach Kursende) — das schlug fehl.
 *
 * Ursache: Das Ablaufdatum eines Kurs-Credits wurde als reines Kalenderdatum
 * berechnet (`new Date(dateStr); setDate(+8)`). Ohne Uhrzeit landet das
 * automatisch auf Mitternacht UTC — in Berliner Zeit ca. 1-2 Uhr NACHTS des
 * 8. Tages. Dadurch war der komplette 8. Tag praktisch blockiert, sobald eine
 * Stunde nach ca. 2 Uhr morgens beginnt (bei Abendstunden also immer).
 *
 * Fix: lib/session-time.ts#courseCreditExpiryBerlin() liefert jetzt 23:59:59 Uhr
 * Berliner Zeit am 8. Tag — verwendet an allen Stellen, die das Ablaufdatum
 * setzen (app/admin/yogis/[id]/page.tsx, app/admin/kurse/page.tsx ×2) UND an der
 * Live-Fensterprüfung beim Buchen (lib/credit-selector.ts).
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { courseCreditExpiryBerlin } from '../../lib/session-time'
import { selectCreditForBooking } from '../../lib/credit-selector'
import { getAdminClient, getUserIdByEmail } from '../utils/db'
import { createTestCourse, E2E_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

function makeServiceClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Berlin-Uhrzeit-Komponenten eines Zeitpunkts (DST-sicher über Intl statt UTC-Offset-Annahme).
function berlinParts(d: Date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(d)) parts[p.type] = p.value
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour, minute: parts.minute, second: parts.second }
}

test.describe('[E2E] Nachholfrist: kompletter 8. Tag zählt (Sarah-Bugfix 2026-08-18)', () => {
  test('courseCreditExpiryBerlin: 23:59:59 Berlin am 8. Tag, nicht Mitternacht', () => {
    const result = courseCreditExpiryBerlin('2026-08-25') // Dienstag
    const p = berlinParts(result)
    expect(p.date, 'Ablaufdatum muss auf den 8. Tag danach fallen (02.09.)').toBe('2026-09-02')
    expect(p.hour, 'Uhrzeit muss 23 Uhr sein (Tagesende), nicht kurz nach Mitternacht').toBe('23')
    expect(p.minute).toBe('59')
    expect(p.second).toBe('59')
  })

  test('courseCreditExpiryBerlin: Kalendertag-Addition bleibt über Monatsgrenzen korrekt', () => {
    const result = courseCreditExpiryBerlin('2026-08-28')
    const p = berlinParts(result)
    expect(p.date).toBe('2026-09-05')
    expect(p.hour).toBe('23')
  })

  test('Quellcode: alle 3 Vergabe-Stellen + die Live-Fensterprüfung nutzen courseCreditExpiryBerlin', () => {
    const adminYogis = read('app/admin/yogis/[id]/page.tsx')
    expect(adminYogis).toMatch(/return courseCreditExpiryBerlin\(lastStr\)/)
    expect(adminYogis).not.toMatch(/last\.setDate\(last\.getDate\(\) \+ 8\)/)

    const adminKurse = read('app/admin/kurse/page.tsx')
    const calls = adminKurse.match(/courseCreditExpiryBerlin\(/g) || []
    expect(calls.length, 'admin/kurse: beide Vergabe-Stellen (Direktzuweisung + Rollover) müssen den Helper nutzen').toBeGreaterThanOrEqual(2)
    expect(adminKurse).not.toMatch(/expiresAt\.setDate\(expiresAt\.getDate\(\) \+ 8\)/)

    const creditSelector = read('lib/credit-selector.ts')
    expect(creditSelector).toMatch(/courseCreditExpiryBerlin\(courseEnd\)\.getTime\(\)/)
    expect(creditSelector).not.toMatch(/EIGHT_DAYS_MS/)
  })

  test('Echtes Szenario: Kursende Dienstag 18:00 → Nachholen Mittwoch (Tag 8) 18:30 ist buchbar', async () => {
    const db = await getAdminClient()
    const yogiId = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    await db.from('credits').delete().eq('user_id', yogiId).eq('model', 'course')
    await db.from('waitlist').delete().eq('user_id', yogiId)

    // Kurs mit letzter (=einziger) Stunde "Dienstag" 18:00 Uhr, in 10 Tagen.
    const course = await createTestCourse({
      name: `${E2E_PREFIX} Nachhol-Ganzer-8-Tag`, sessionCount: 1, startDaysFromNow: 10, maxSpots: 5,
    })
    const originSessionId = course.sessionIds[0]
    const courseEndStr = course.sessionDates[0]
    await db.from('courses').update({ date_end: courseEndStr, time_start: '18:00:00' }).eq('id', course.courseId)
    await db.from('sessions').update({ time_start: '18:00:00' }).eq('id', originSessionId)

    // Kurs-Credit GENAU so vergeben, wie es die (jetzt gefixte) Produktions-Logik tut.
    const expiresAt = courseCreditExpiryBerlin(courseEndStr)
    const { data: credit } = await db.from('credits').insert({
      user_id: yogiId, course_id: course.courseId, model: 'course',
      total: 1, used: 0, expires_at: expiresAt.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogiId, course_id: course.courseId })
    await db.from('bookings').insert({
      user_id: yogiId, session_id: originSessionId, credit_id: credit!.id, type: 'course', status: 'active',
    })
    // Stunde fällt aus (illness/o.ä.) — Credit wird frei, Yogi will nachholen.
    await db.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('user_id', yogiId).eq('session_id', originSessionId)

    // Ziel-Stunde: exakt Tag 8 nach Kursende, 18:30 Uhr (30 Min nach der Original-Zeit,
    // genau der von Sarah gemeldete Fall). Als eigener Kurs angelegt, damit sie nicht
    // vom selben Kurs-Ende-Datum abhängt.
    const day8 = new Date(`${courseEndStr}T12:00:00Z`)
    day8.setUTCDate(day8.getUTCDate() + 8)
    const day8Str = day8.toISOString().split('T')[0]
    const targetCourse = await createTestCourse({
      name: `${E2E_PREFIX} Nachhol-Ganzer-8-Tag-Ziel`, sessionCount: 1, startDaysFromNow: 1, maxSpots: 5,
    })
    const targetSessionId = targetCourse.sessionIds[0]
    await db.from('sessions').update({ date: day8Str, time_start: '18:30:00' }).eq('id', targetSessionId)

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogiId, targetSessionId, day8Str, '18:30:00')

    expect(pick.ok, `Tag 8 (${day8Str}) 18:30 Uhr muss buchbar sein — Kursende war ${courseEndStr} 18:00 Uhr. ${!pick.ok ? pick.message : ''}`).toBe(true)
    if (pick.ok) {
      expect(pick.creditId).toBe(credit!.id)
      expect(pick.originSessionId).toBe(originSessionId)
    }

    await db.from('bookings').delete().eq('user_id', yogiId).in('session_id', [originSessionId, targetSessionId])
    await db.from('credits').delete().eq('id', credit!.id)
    await db.from('enrollments').delete().eq('user_id', yogiId).eq('course_id', course.courseId)
    for (const c of [course, targetCourse]) {
      await db.from('sessions').delete().eq('course_id', c.courseId)
      await db.from('courses').delete().eq('id', c.courseId)
    }
  })
})
