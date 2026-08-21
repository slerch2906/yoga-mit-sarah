/**
 * Live-Test-Bugfixes (Sarah 2026-05-30):
 *  1. Einladung + direkte Kursbuchung: RPC read_invitation_by_token MUSS
 *     credits_to_assign liefern, sonst überspringt die Register-Seite das
 *     Enrollment/Booking still (Kern-Bug der Einladungslinks).
 *  3a. Protokoll: Event-Buchung als „(Event)" statt „(Einzelstunde)".
 *  3b. Protokoll: Warteliste-Einträge zeigen die konkrete Stunde (Datum/Zeit).
 *  2.  Dashboard-Kacheln zählen den Stand der Stunden DIESER Woche.
 */
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { getAdminClient } from '../utils/db'
import { createTestCourse, E2E_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })
function svc() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

test.describe('[E2E] Live-Bugfixes 2026-05-30', () => {
  test('[E2E] Bug1: read_invitation_by_token liefert credits_to_assign + course_total_units', async () => {
    const db = await getAdminClient()
    const course = await createTestCourse({ name: `${E2E_PREFIX} Einladung-RPC`, sessionCount: 4, startDaysFromNow: 7 })
    const token = `e2e-inv-${Date.now()}`
    await db.from('invitations').insert({
      token,
      email: `e2e.invite.${Date.now()}@example.com`,
      first_name: 'E2E', last_name: 'Invite',
      course_id: course.courseId, credits_to_assign: 4, used: false,
      expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    })
    try {
      const { data, error } = await svc().rpc('read_invitation_by_token', { p_token: token })
      expect(error).toBeNull()
      const row = Array.isArray(data) ? data[0] : data
      expect(row?.course_id).toBe(course.courseId)
      // KERN: ohne credits_to_assign wird der Yogi nach Registrierung NICHT in den Kurs gebucht.
      expect(row?.credits_to_assign, 'RPC muss credits_to_assign liefern').toBe(4)
      expect(row?.course_total_units, 'RPC muss course_total_units liefern').toBe(4)
    } finally {
      await db.from('invitations').delete().eq('token', token)
    }
  })

  test('[E2E] Bug3a/3b: Protokoll-Formatter — Event-Label + Warteliste zeigt die Stunde', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/admin/yogis/[id]/page.tsx'), 'utf8')
    // 3a: booking_created-Label am session_type (Event), nicht nur an d.type
    expect(src.includes("' (Event)'"), 'booking_created kennt das (Event)-Label').toBe(true)
    expect(src.includes('effType')).toBe(true)
    // 3b: waitlist_joined + waitlist_promoted setzen subject auf termin (Datum/Zeit · Kurs)
    const joinedIdx = src.indexOf("case 'waitlist_joined'")
    const promoIdx = src.indexOf("case 'waitlist_promoted'")
    expect(joinedIdx).toBeGreaterThan(0)
    expect(promoIdx).toBeGreaterThan(0)
    expect(src.slice(joinedIdx, joinedIdx + 400)).toMatch(/subject:\s*termin/)
    expect(src.slice(promoIdx, promoIdx + 400)).toMatch(/subject:\s*termin/)
  })

  test('[E2E] Bug2: Dashboard-Kacheln beziehen sich auf DIESE Woche', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/admin/dashboard/page.tsx'), 'utf8')
    // Aktualisiert 2026-08-21: Die urspruengliche Umsetzung (weekSessionIds /
    // bookingsThisWeek — Roll-up ueber die Stunden der Woche) wurde am 02.06.
    // bewusst ersetzt. Die Kacheln messen jetzt REINE YOGI-AKTIVITAET im
    // angezeigten Wochenfenster, gezaehlt nach Zeitpunkt der Aktion im
    // Protokoll — Admin-Aktionen zaehlen nicht mit. Der Test prueft weiterhin
    // die Kern-Eigenschaft "Kacheln sind auf die angezeigte Woche begrenzt",
    // nur eben an der aktuellen Umsetzung.
    expect(src, 'Zaehlung pro Woche vorhanden').toMatch(/countWeekAction/)
    expect(src, 'Wochenfenster begrenzt die Zaehlung').toMatch(
      /gte\('created_at', weekStartTs\)[\s\S]{0,40}lt\('created_at', weekEndExclTs\)/
    )
    for (const action of ['booking_created', 'booking_cancelled', 'waitlist_joined']) {
      expect(src, `Kachel-Aktion ${action} wird gezaehlt`).toMatch(
        new RegExp(`countWeekAction\\('${action}'\\)`)
      )
    }
  })

  test('[E2E] Bug4: Kachel-Detail (/admin/stats) zeigt echten Titel statt SYS-Container', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/admin/stats/[type]/page.tsx'), 'utf8')
    // Echte Titel-Auflösung statt SYS-Name: sessionDisplayName + Session-Nachladen via session_id
    expect(src.includes('sessionDisplayName'), 'nutzt sessionDisplayName').toBe(true)
    expect(src.includes('session_type'), 'lädt session_type für Event/Einzelstunde').toBe(true)
    expect(src.includes('details?.session_id') || src.includes('details.session_id'), 'löst über details.session_id auf').toBe(true)
    // Der SYS-Container-Name darf NICHT mehr als primäres Label gerendert werden:
    // weder {details.course_name} · ... noch {course?.name} · ... als Hauptzeile.
    expect(src.includes('{details.course_name} ·'), 'kein details.course_name als Label').toBe(false)
    expect(src.includes('{course?.name} ·'), 'kein course?.name als Label').toBe(false)
  })
})
