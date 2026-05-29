#!/usr/bin/env ts-node
/**
 * Test-Setup für die LIVE-App: Spätangebot-Szenario (Sarah 2026-05-29).
 *
 * Ausführen mit:  npm run test:szenario:spaetangebot
 *
 * Was passiert:
 *   1. KOMPLETTER RESET: alle [E2E]-Testdaten werden aus der App gelöscht
 *      (cleanupAllE2EData — nur Test-Kurse + Test-Accounts, NIE echte Nutzer).
 *   2. Es wird EIN sauberes Szenario angelegt:
 *        "Stunde startet in 60 Minuten" (≤ 90 Min ⇒ Spätangebot-Pfad)
 *        - Einzelstunde (max_spots = 1), Start in 60 Minuten
 *        - Test-Yogi1 ist gebucht (belegt den einen Platz)
 *        - Test-Yogi2 steht auf der Warteliste (+ 1 Einzel-Credit zum Nachrücken)
 *      Meldet sich Yogi1 jetzt ab, MUSS Yogi2 ein Spätangebot bekommen
 *      (genau der am 2026-05-29 deployte RLS-Kontext-Fix).
 *
 * Idempotent: Schritt 1 räumt vorherige Läufe weg, danach existiert genau ein
 * Szenario. Mehrfaches Ausführen erzeugt also keine Duplikate.
 */
import * as dotenv from 'dotenv'
import { getAdminClient, getUserIdByEmail } from '../tests/utils/db'
import { cleanupAllE2EData, giveYogiSingleCredit, E2E_PREFIX } from '../tests/utils/seed'

dotenv.config({ path: '.env.test' })

const SCENARIO_NAME = `${E2E_PREFIX} Spätangebot 60min`

/** Lokale (Berlin-)Datum/Zeit-Strings für "in N Minuten" — so wie die App parst. */
function inMinutes(min: number): { date: string; time: string } {
  const d = new Date(Date.now() + min * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:00`,
  }
}

async function main() {
  const required = [
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'TEST_ADMIN_EMAIL', 'TEST_ADMIN_PASSWORD',
    'TEST_YOGI1_EMAIL', 'TEST_YOGI2_EMAIL',
  ]
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error('❌ Fehlende Umgebungsvariablen in .env.test:')
    missing.forEach(k => console.error(`   ${k}`))
    process.exit(1)
  }

  console.log('🧹 Schritt 1/2: Komplett-Reset aller [E2E]-Testdaten…')
  await cleanupAllE2EData()

  console.log('\n🛠  Schritt 2/2: Szenario "Stunde startet in 60 Minuten → Spätangebot" anlegen…')

  const db = await getAdminClient()
  const yogi1Id = await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!)
  const yogi2Id = await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!)
  if (!yogi1Id || !yogi2Id) throw new Error('Test-Yogi1/Yogi2 nicht gefunden — bitte zuerst npm run test:setup ausführen.')

  // Sicherheitscheck: existiert das Szenario schon? (sollte nach dem Reset nicht
  // der Fall sein — "wenns nicht schon drin ist").
  const { data: existing } = await db.from('courses').select('id').eq('name', SCENARIO_NAME).maybeSingle()
  if (existing) {
    console.log('ℹ️  Szenario ist bereits vorhanden — überspringe Anlage.')
    return
  }

  const { date, time } = inMinutes(60)

  // Einzelstunde als Kurs-Container (max_spots = 1).
  const { data: course, error: courseErr } = await db.from('courses').insert({
    name: SCENARIO_NAME,
    weekday: new Date(`${date}T${time}`).toLocaleDateString('de-DE', { weekday: 'long' }),
    time_start: time,
    duration_min: 75,
    max_spots: 1,
    total_units: 1,
    date_start: date,
    date_end: date,
    location: 'E2E Teststudio',
    is_active: true,
    is_single: true,
    is_open: true,
  }).select('id').single()
  if (courseErr || !course) throw new Error(`Kurs-Insert fehlgeschlagen: ${courseErr?.message}`)

  const { data: sess, error: sessErr } = await db.from('sessions').insert({
    course_id: course.id,
    date,
    time_start: time,
    duration_min: 75,
    is_cancelled: false,
    session_type: 'single',
    name: `${E2E_PREFIX} Spätangebot-Stunde`,
    max_spots: 1,
  }).select('id').single()
  if (sessErr || !sess) throw new Error(`Session-Insert fehlgeschlagen: ${sessErr?.message}`)

  // Yogi1 belegt den Platz.
  const { error: bookErr } = await db.from('bookings').insert({
    user_id: yogi1Id, session_id: sess.id, credit_id: null, type: 'single', status: 'active',
  })
  if (bookErr) throw new Error(`Booking-Insert fehlgeschlagen: ${bookErr.message}`)

  // Yogi2 wartet (+ Credit fürs Nachrücken/Claim).
  const { error: wlErr } = await db.from('waitlist').insert({
    user_id: yogi2Id, session_id: sess.id, type: 'waitlist', position: 1,
  })
  if (wlErr) throw new Error(`Waitlist-Insert fehlgeschlagen: ${wlErr.message}`)
  await giveYogiSingleCredit(yogi2Id, 3)

  console.log('\n✅ Szenario angelegt:')
  console.log(`   Kurs/Stunde : ${SCENARIO_NAME}`)
  console.log(`   Beginn      : ${date} ${time}  (in ~60 Min ⇒ ≤90-Min-Spätangebot-Pfad)`)
  console.log(`   Gebucht     : Test-Yogi1 (${process.env.TEST_YOGI1_EMAIL})`)
  console.log(`   Warteliste  : Test-Yogi2 (${process.env.TEST_YOGI2_EMAIL}) + 1 Einzel-Credit`)
  console.log('\n👉 Test: Als Yogi1 abmelden → Yogi2 muss ein Spätangebot per Mail bekommen.')
}

main().then(() => process.exit(0)).catch(err => {
  console.error('\n❌ Setup fehlgeschlagen:', err.message)
  process.exit(1)
})
