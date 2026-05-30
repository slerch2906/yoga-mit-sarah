/**
 * Workflow (Sarah-Fix 2026-05-29): Kurs-Löschung im Backend darf Guthaben NICHT
 * mitlöschen — es muss entkoppelt werden (course_id=null) und für seine volle
 * Gültigkeit (Krankheit 10 Mon / Kursabbruch 2 J) erhalten bleiben. Der Kurstitel
 * muss DAUERHAFT erhalten bleiben über die neue Spalte credits.source_course_name.
 *
 * Spiegelt den Credit-Teil von deleteCourse() in app/admin/kurse/page.tsx:
 *   credits.update({course_id:null}).eq('course_id',cid).eq('model','guthaben')
 *   credits.delete().eq('course_id',cid).neq('model','guthaben')
 *
 * Stil: 40-krankheit-austragen-flow.spec.ts (DB-Setup + Assertions).
 */
import { test, expect } from '@playwright/test'
import { E2E_PREFIX, futureDateStr } from '../utils/seed'
import { getUserIdByEmail, getAdminClient, getServiceClient } from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('[E2E] Kurs-Löschung entkoppelt Guthaben (statt mitlöschen)', () => {
  test('deleteCourse: Guthaben bleibt erhalten, course_id=null, Titel via source_course_name, Kurs-Credit weg', async () => {
    const yogiId = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()

    // Cleanup vorab
    await db.from('credits').delete().eq('user_id', yogiId).eq('source', 'illness')

    // 1) Quell-Kurs anlegen
    const dateStr = futureDateStr(20)
    const { data: course } = await db.from('courses').insert({
      name: `${E2E_PREFIX} Kurs-Loeschen-Guthaben`,
      weekday: 'Montag', time_start: '18:00:00', duration_min: 60,
      max_spots: 5, total_units: 1,
      date_start: dateStr, date_end: dateStr,
      is_active: true, is_single: false, is_open: false,
    }).select('id, name').single()
    const courseId = course!.id

    // 2) Guthaben aus Krankheit (10 Mon) — mit source_course_name (Titel-Snapshot)
    const expires = new Date(); expires.setMonth(expires.getMonth() + 10)
    const { data: guthaben } = await db.from('credits').insert({
      user_id: yogiId, course_id: courseId, source_course_name: course!.name,
      model: 'guthaben', source: 'illness', total: 4, used: 0,
      expires_at: expires.toISOString(),
    } as any).select('id, expires_at').single()
    const guthabenId = guthaben!.id

    // 3) Zusätzlich ein kursgebundener Course-Credit (muss beim Löschen WEG)
    const { data: courseCred } = await db.from('credits').insert({
      user_id: yogiId, course_id: courseId,
      model: 'course', total: 1, used: 0,
      expires_at: expires.toISOString(),
    } as any).select('id').single()

    try {
      // ── SIMULIERT deleteCourse Credit-Schritt ────────────────────────────
      // Guthaben entkoppeln (NICHT löschen):
      await db.from('credits').update({ course_id: null })
        .eq('course_id', courseId).eq('model', 'guthaben')
      // Kursgebundene Credits löschen:
      await db.from('credits').delete()
        .eq('course_id', courseId).neq('model', 'guthaben')
      // Kurs löschen:
      await db.from('courses').delete().eq('id', courseId)

      // ── ASSERTIONS ───────────────────────────────────────────────────────

      // a) Guthaben existiert NOCH
      const { data: g } = await db.from('credits')
        .select('id, course_id, source_course_name, total, used, expires_at, model, source')
        .eq('id', guthabenId).maybeSingle()
      expect(g, 'Guthaben muss nach Kurs-Löschung erhalten bleiben').not.toBeNull()
      expect(g!.model).toBe('guthaben')
      expect(g!.total).toBe(4)

      // b) course_id entkoppelt
      expect(g!.course_id, 'course_id muss entkoppelt (null) sein').toBeNull()

      // c) Kurstitel bleibt dauerhaft erhalten
      expect(g!.source_course_name, 'Kurstitel muss in source_course_name erhalten bleiben')
        .toBe(course!.name)

      // d) Gültigkeit unverändert (10 Monate)
      expect(new Date(g!.expires_at as string).getTime())
        .toBe(new Date(guthaben!.expires_at as string).getTime())

      // e) Kursgebundener Course-Credit ist WEG
      const { data: cc } = await db.from('credits')
        .select('id').eq('id', courseCred!.id).maybeSingle()
      expect(cc, 'Kursgebundener Course-Credit muss mitgelöscht sein').toBeNull()
    } finally {
      await db.from('credits').delete().eq('id', guthabenId)
      await db.from('credits').delete().eq('user_id', yogiId).eq('source', 'illness')
      await db.from('courses').delete().eq('id', courseId)
    }
  })

  test('DB-Schema: credits.source_course_name existiert', async () => {
    const db = getServiceClient()
    const { error } = await db.from('credits').select('source_course_name').limit(1)
    expect(error?.message || '').toBe('')
  })
})

test.describe('[E2E] Kurs-Löschung: Kursabbruch-Guthaben (2 Jahre) überlebt', () => {
  // Sarahs #1-Garantie (Deep-QA 2026-05-29): Wird ein Kurs gelöscht, muss das aus
  // einem Kursabbruch entstandene Guthaben (source='cancellation_choice') mit seiner
  // VOLLEN 2-Jahres-Frist erhalten bleiben. Spiegelt deleteCourse-Credit-Schritt
  // (app/admin/kurse/page.tsx:1287-1290) — Pendant zum Krankheits-Fall (10 Mon) oben.
  test('deleteCourse: cancellation_choice-Guthaben bleibt, course_id=null, 2-Jahres-Frist unverändert, Titel via source_course_name', async () => {
    const yogiId = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()

    // Cleanup vorab
    await db.from('credits').delete().eq('user_id', yogiId).eq('source', 'cancellation_choice')

    // 1) Quell-Kurs anlegen
    const dateStr = futureDateStr(20)
    const { data: course } = await db.from('courses').insert({
      name: `${E2E_PREFIX} Kursabbruch-2J-Guthaben`,
      weekday: 'Montag', time_start: '18:00:00', duration_min: 60,
      max_spots: 5, total_units: 1,
      date_start: dateStr, date_end: dateStr,
      is_active: true, is_single: false, is_open: false,
    }).select('id, name').single()
    const courseId = course!.id

    // 2) Kursabbruch-Guthaben (2 Jahre) — exakt wie admin/kurse/page.tsx:981-998
    const expiry2y = new Date(); expiry2y.setFullYear(expiry2y.getFullYear() + 2)
    const { data: guthaben } = await db.from('credits').insert({
      user_id: yogiId, course_id: courseId, source_course_name: course!.name,
      model: 'guthaben', source: 'cancellation_choice', total: 8, used: 0,
      expires_at: expiry2y.toISOString(),
    } as any).select('id, expires_at').single()
    const guthabenId = guthaben!.id

    try {
      // ── SIMULIERT deleteCourse Credit-Schritt (app/admin/kurse/page.tsx:1287-1290) ──
      await db.from('credits').update({ course_id: null })
        .eq('course_id', courseId).eq('model', 'guthaben')
      await db.from('credits').delete()
        .eq('course_id', courseId).neq('model', 'guthaben')
      await db.from('courses').delete().eq('id', courseId)

      // ── ASSERTIONS ───────────────────────────────────────────────────────
      const { data: g } = await db.from('credits')
        .select('id, course_id, source_course_name, total, expires_at, model, source')
        .eq('id', guthabenId).maybeSingle()
      expect(g, 'Kursabbruch-Guthaben muss nach Kurs-Löschung erhalten bleiben').not.toBeNull()
      expect(g!.model).toBe('guthaben')
      expect(g!.source).toBe('cancellation_choice')
      expect(g!.total).toBe(8)

      // course_id entkoppelt
      expect(g!.course_id, 'course_id muss entkoppelt (null) sein').toBeNull()

      // Kurstitel bleibt dauerhaft erhalten
      expect(g!.source_course_name, 'Kurstitel muss in source_course_name erhalten bleiben')
        .toBe(course!.name)

      // 2-Jahres-Frist EXAKT unverändert (Sarahs #1-Garantie)
      expect(new Date(g!.expires_at as string).getTime(),
        '2-Jahres-Frist darf durch Kurs-Löschung NICHT verkürzt werden')
        .toBe(new Date(guthaben!.expires_at as string).getTime())

      // ...und liegt ~2 Jahre in der Zukunft (Toleranz 2 Tage)
      const expiryDt = new Date(g!.expires_at as string)
      const expected2y = new Date(); expected2y.setFullYear(expected2y.getFullYear() + 2)
      const diffDays = Math.abs((expiryDt.getTime() - expected2y.getTime()) / (1000 * 60 * 60 * 24))
      expect(diffDays, 'Frist muss ~2 Jahre ab heute liegen').toBeLessThan(2)
    } finally {
      await db.from('credits').delete().eq('id', guthabenId)
      await db.from('credits').delete().eq('user_id', yogiId).eq('source', 'cancellation_choice')
      await db.from('courses').delete().eq('id', courseId)
    }
  })
})
