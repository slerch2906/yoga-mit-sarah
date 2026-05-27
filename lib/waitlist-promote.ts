/**
 * Zentrale Helper-Funktion für Waitlist-Promote bei freiem Platz.
 *
 * Sarah-Regel 2026-05-23:
 * - Stunden-Beginn > 90 Min in der Zukunft → AUTO-PROMOTE (alte Logic):
 *   ersten Waitlist-Yogi sofort einbuchen + waitlistPromoted-Email.
 * - Stunden-Beginn ≤ 90 Min → 90-MIN-CUTOFF (neue Logic):
 *   ALLE Waitlist-Yogis bekommen gleichzeitig eine waitlist_offer_late-Email
 *   mit magic-Link → wer zuerst klickt, kriegt den Platz.
 * - Notify-Subscribers werden IMMER informiert (unabhängig von 90-Min-Regel).
 *
 * Wird aufgerufen aus allen Abmelde-Pfaden:
 * - app/admin/sessions/[id]/page.tsx (cancelBookingForYogi)
 * - app/kurse/[id]/page.tsx (yogi self-cancel)
 * - app/meine/page.tsx (yogi self-cancel)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { Email } from './email'

const NINETY_MIN_MS = 90 * 60 * 1000

/**
 * Wird nach einem Abmelden aufgerufen. Entscheidet selber ob Auto-Promote
 * oder Late-Offer + verarbeitet Notify-Subscribers separat.
 */
export async function promoteWaitlistOrOfferLate(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<{ mode: 'auto-promoted' | 'late-offer-sent' | 'noop'; details?: any }> {
  // 1) Session-Daten holen
  const { data: session } = await supabase.from('sessions')
    .select('id, date, time_start, is_cancelled, course:courses(name, is_free)')
    .eq('id', sessionId).maybeSingle()
  if (!session || (session as any).is_cancelled) return { mode: 'noop' }

  const sessionStart = new Date(`${(session as any).date}T${(session as any).time_start}`).getTime()
  const now = Date.now()
  if (sessionStart <= now) return { mode: 'noop' } // Stunde hat bereits begonnen

  const minutesUntilStart = (sessionStart - now) / 60000
  const courseName = (session as any).course?.name || ''
  const isFreeCourse = !!(session as any).course?.is_free
  const dateStr = (session as any).date
  const timeStr = (session as any).time_start

  // 2) Alle Waitlist-Yogis dieser Session laden (älteste zuerst)
  const { data: waitlistRows } = await supabase.from('waitlist')
    .select('*, profile:profiles(email, first_name)')
    .eq('session_id', sessionId).eq('type', 'waitlist')
    .order('created_at', { ascending: true })
  const waitlist = (waitlistRows || []) as any[]

  // 3) Notify-Subscribers IMMER informieren — auch wenn Waitlist gefüllt wird
  await notifyAllSubscribers(supabase, sessionId, { courseName, dateStr, timeStr })

  if (waitlist.length === 0) return { mode: 'noop' }

  // 4) Über 90 Min: alte Auto-Promote Logic — ersten Yogi mit gültigem Credit nehmen
  // Bei Charity (is_free): IMMER den ersten Yogi nehmen, kein Credit nötig.
  if (sessionStart - now > NINETY_MIN_MS) {
    for (const wl of waitlist) {
      const promoted = isFreeCourse
        ? await tryAutoPromoteOneFree(supabase, wl, sessionId, { courseName, dateStr, timeStr })
        : await tryAutoPromoteOne(supabase, wl, sessionId, { courseName, dateStr, timeStr })
      if (promoted) return { mode: 'auto-promoted', details: { user_id: wl.user_id } }
    }
    return { mode: 'noop' }
  }

  // 5) ≤ 90 Min: Late-Offer an alle Waitlist-Yogis schicken
  for (const wl of waitlist) {
    if (!wl.profile?.email) continue
    // Insert waitlist_offer-Row (token wird in DB generiert via DEFAULT)
    const expiresAt = new Date(sessionStart).toISOString()
    const { data: offer } = await supabase.from('waitlist_offers').upsert({
      session_id: sessionId,
      user_id: wl.user_id,
      expires_at: expiresAt,
      claimed_at: null,
      resolved_winner_user_id: null,
    }, { onConflict: 'session_id,user_id' }).select('token').maybeSingle()
    if (!offer?.token) continue
    try {
      await Email.waitlistOfferLate({
        email: wl.profile.email,
        firstName: wl.profile.first_name || 'Yogi',
        courseName, date: dateStr, timeStart: timeStr,
        offerToken: offer.token,
      })
    } catch (e) { console.error('waitlistOfferLate email:', e) }
  }
  return { mode: 'late-offer-sent', details: { recipients: waitlist.length } }
}

/**
 * Charity-Variante: Yogi promoten OHNE Credit (für is_free Kurse).
 * Keine Credit-Konflikt-Logik nötig, weil keine Credits verbraucht werden.
 */
async function tryAutoPromoteOneFree(
  supabase: SupabaseClient, wl: any, sessionId: string,
  meta: { courseName: string; dateStr: string; timeStr: string },
): Promise<boolean> {
  await supabase.from('bookings').upsert({
    user_id: wl.user_id, session_id: sessionId, credit_id: null,
    type: 'single', status: 'active', cancelled_at: null, cancel_late: false,
  }, { onConflict: 'user_id,session_id' })
  await supabase.from('waitlist').delete().eq('id', wl.id)
  if (wl.profile?.email) {
    try {
      await Email.waitlistPromoted({
        email: wl.profile.email,
        firstName: wl.profile.first_name || 'Yogi',
        courseName: meta.courseName, date: meta.dateStr, timeStart: meta.timeStr,
      })
    } catch (e) { console.error('waitlistPromoted (free) email:', e) }
  }
  return true
}

/** Hilfs-Funktion: einen Yogi aus Waitlist auto-promoten (Course/Tenpack-Credit). */
async function tryAutoPromoteOne(
  supabase: SupabaseClient, wl: any, sessionId: string,
  meta: { courseName: string; dateStr: string; timeStr: string },
): Promise<boolean> {
  // Hat der Yogi einen freien Credit?
  const nowIso = new Date().toISOString()
  const { data: credits } = await supabase.from('credits')
    .select('id, total, used, model').eq('user_id', wl.user_id)
    .gt('expires_at', nowIso)
  const free = (credits || []).filter((c: any) => c.total > c.used && c.model !== 'guthaben')
  if (free.length === 0) return false
  // Einfach den ersten freien Credit nehmen
  const credit = free[0]
  await supabase.from('bookings').upsert({
    user_id: wl.user_id, session_id: sessionId, credit_id: credit.id,
    type: 'single', status: 'active', cancelled_at: null, cancel_late: false,
  }, { onConflict: 'user_id,session_id' })
  // Waitlist-Eintrag entfernen
  await supabase.from('waitlist').delete().eq('id', wl.id)
  // Email
  if (wl.profile?.email) {
    try {
      await Email.waitlistPromoted({
        email: wl.profile.email,
        firstName: wl.profile.first_name || 'Yogi',
        courseName: meta.courseName, date: meta.dateStr, timeStart: meta.timeStr,
      })
    } catch (e) { console.error('waitlistPromoted email:', e) }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Sarah-Wunsch 2026-05-24: Wenn der Yogi durch dieses Promote seinen
  // LETZTEN freien Credit aufgebraucht hat, muss er auch von allen
  // ANDEREN Wartelisten entfernt werden (sonst würde später ein zweites
  // Promote versuchen, fehlschlagen mangels Credit, und der Platz
  // springt verspätet zum nächsten Yogi).
  //
  // Re-Check OHNE den gerade verwendeten Credit:
  //   credit.used wurde durch den DB-Trigger trg_sync_credit_used jetzt um
  //   1 hochgesetzt. Wir laden Credits neu und schauen ob noch welche frei
  //   sind. Wenn nein → alle anderen "waitlist"-Einträge löschen (nicht
  //   "notify"-Einträge, die sind reine Benachrichtigungs-Wünsche).
  // ───────────────────────────────────────────────────────────────────────
  const { data: creditsAfter } = await supabase.from('credits')
    .select('id, total, used, model').eq('user_id', wl.user_id)
    .gt('expires_at', nowIso)
  const stillFree = (creditsAfter || []).filter((c: any) => c.total > c.used && c.model !== 'guthaben')

  if (stillFree.length === 0) {
    // Alle anderen waitlist-Einträge dieses Yogis holen
    const { data: otherWaitlists } = await supabase.from('waitlist')
      .select('id, session_id, session:sessions(date, time_start, course:courses(name))')
      .eq('user_id', wl.user_id).eq('type', 'waitlist')

    if (otherWaitlists && otherWaitlists.length > 0) {
      const idsToDelete = otherWaitlists.map((w: any) => w.id)
      await supabase.from('waitlist').delete().in('id', idsToDelete)

      // Pro entfernter Warteliste eine Email an den Yogi (so wie beim
      // Self-Booking-Pfad in app/kurse/[id]/page.tsx handleBook)
      if (wl.profile?.email) {
        for (const w of otherWaitlists as any[]) {
          try {
            await Email.waitlistRemovedCreditUsedElsewhere({
              email: wl.profile.email,
              firstName: wl.profile.first_name || 'Yogi',
              courseName: w.session?.course?.name || '',
              date: w.session?.date || '',
              timeStart: w.session?.time_start || '',
            })
          } catch (e) { console.error('waitlistRemovedCreditUsedElsewhere email:', e) }
        }
      }
    }
  }

  return true
}

/** Notify-Subscribers für eine Session immer benachrichtigen. */
async function notifyAllSubscribers(
  supabase: SupabaseClient, sessionId: string,
  meta: { courseName: string; dateStr: string; timeStr: string },
) {
  const { data: notifyRows } = await supabase.from('waitlist')
    .select('*, profile:profiles(email, first_name)')
    .eq('session_id', sessionId).eq('type', 'notify')
  // Welle S2/M4 (Sarah 2026-05-27): Vorher wurden alle notify-Eintraege
  // pauschal geloescht — bei Brevo-Down war die Yogi-Subscription weg, ohne
  // dass die Mail je ankam. Jetzt tracken wir pro Eintrag, ob die Mail
  // erfolgreich rausging, und loeschen NUR die erfolgreichen aus der Tabelle.
  const succeededUserIds: string[] = []
  for (const nu of (notifyRows || [])) {
    const userId = (nu as any).user_id
    if (!(nu as any).profile?.email) {
      // Kein Email-Adress = nichts zu schicken — Eintrag dennoch loeschen,
      // sonst bleibt er fuer immer haengen.
      if (userId) succeededUserIds.push(userId)
      continue
    }
    try {
      const result = await Email.notifyPlaceFree({
        email: (nu as any).profile.email,
        firstName: (nu as any).profile.first_name || 'Yogi',
        courseName: meta.courseName, date: meta.dateStr, timeStart: meta.timeStr,
        sessionId,
      })
      if (result && result.ok !== false && userId) succeededUserIds.push(userId)
    } catch (e) { console.error('notifyPlaceFree email:', e) }
  }
  // Nur die erfolgreich benachrichtigten notify-Eintraege loeschen.
  if (succeededUserIds.length > 0) {
    await supabase.from('waitlist').delete()
      .eq('session_id', sessionId).eq('type', 'notify')
      .in('user_id', succeededUserIds)
  }
}
