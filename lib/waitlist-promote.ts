/**
 * Zentrale Helper-Funktion für Waitlist-Promote bei freiem Platz.
 *
 * Sarah-Regel 2026-05-23:
 * - Stunden-Beginn > 90 Min in der Zukunft → AUTO-PROMOTE:
 *   ersten passenden Waitlist-Yogi sofort einbuchen + waitlistPromoted-Email.
 * - Stunden-Beginn ≤ 90 Min → 90-MIN-CUTOFF (Spätangebot):
 *   ALLE Waitlist-Yogis bekommen gleichzeitig eine waitlist_offer_late-Email
 *   mit magic-Link → wer zuerst klickt, kriegt den Platz.
 * - Notify-Subscribers werden nur informiert, wenn der Platz frei BLEIBT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * RLS-Kontext-Fix (Sarah 2026-05-29):
 *   Diese Funktion lief früher CLIENT-SEITIG und las/schrieb waitlist, profiles,
 *   credits, bookings und waitlist_offers direkt. Beim Yogi-SELBST-Abmelden (bzw.
 *   Account-Löschung) griff dabei RLS: ein normaler Yogi sieht nur die EIGENEN
 *   waitlist-/profil-Zeilen → die Warteliste der anderen war unsichtbar → es wurde
 *   KEIN Spätangebot/Nachrücken ausgelöst (Sarah-Repro: Absage 9:56, Start 11:20,
 *   mail@ bekam nichts). Die gesamte privilegierte DB-Arbeit läuft jetzt in der
 *   SECURITY-DEFINER-RPC process_cancellation_full (umgeht RLS). Hier werden nur
 *   noch die Mails aus den kontrolliert zurückgegebenen Daten verschickt.
 *
 * Wird aufgerufen aus allen Abmelde-Pfaden (Admin + Yogi):
 * - app/admin/sessions/[id]/page.tsx, app/admin/... (cancelBookingForYogi etc.)
 * - app/kurse/[id]/page.tsx (yogi self-cancel ≤90)
 * - app/profil/page.tsx (account self-delete)
 * ════════════════════════════════════════════════════════════════════════════
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { Email } from './email'

/**
 * Wird nach einem Abmelden aufgerufen. Die RPC entscheidet server-seitig
 * (RLS-frei) ob Auto-Promote (>90), Spätangebot (≤90) oder nur Notify, legt
 * Buchungen/Offers an und gibt die Mail-Empfänger zurück. Hier nur Mailversand.
 */
export async function promoteWaitlistOrOfferLate(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<{ mode: 'auto-promoted' | 'late-offer-sent' | 'noop'; details?: any }> {
  const { data: result, error } = await supabase.rpc('process_cancellation_full', {
    p_session_id: sessionId,
  })
  if (error) { console.error('process_cancellation_full RPC:', error); return { mode: 'noop' } }
  const mode = (result as any)?.mode

  // ── >90 Min: ein Yogi wurde nachgerückt ──────────────────────────────────
  if (mode === 'auto-promoted') {
    const p = (result as any).promoted
    if (p?.email) {
      try {
        await Email.waitlistPromoted({
          email: p.email,
          firstName: p.first_name || 'Yogi',
          courseName: p.course_name || '',
          date: p.date || '',
          timeStart: p.time_start || '',
          // sessionType → Event-/Einzelstunden-spezifische Texte/Stornoregeln.
          sessionType: p.session_type,
          sessionId,
        })
      } catch (e) { console.error('waitlistPromoted email:', e) }
    }
    // Hat der nachgerückte Yogi seinen letzten Credit aufgebraucht, wurde er
    // server-seitig von allen anderen Wartelisten entfernt → hier informieren.
    for (const r of ((result as any).removed_elsewhere || [])) {
      try {
        await Email.waitlistRemovedCreditUsedElsewhere({
          email: r.email,
          firstName: r.first_name || 'Yogi',
          courseName: r.course_name || '',
          date: r.date || '',
          timeStart: r.time_start || '',
        })
      } catch (e) { console.error('waitlistRemovedCreditUsedElsewhere email:', e) }
    }
    return { mode: 'auto-promoted', details: { user_id: p?.user_id } }
  }

  // ── ≤90 Min mit Warteliste: Spätangebot an ALLE (wer zuerst klickt gewinnt) ─
  if (mode === 'late-offer') {
    const offers = ((result as any).offers || []) as any[]
    for (const o of offers) {
      if (!o?.email || !o?.token) continue
      try {
        await Email.waitlistOfferLate({
          email: o.email,
          firstName: o.first_name || 'Yogi',
          courseName: o.course_name || '',
          date: o.date || '',
          timeStart: o.time_start || '',
          offerToken: o.token,
        })
      } catch (e) { console.error('waitlistOfferLate email:', e) }
    }
    return { mode: 'late-offer-sent', details: { recipients: offers.length } }
  }

  // ── Platz bleibt frei → Notify-Subscriber benachrichtigen ─────────────────
  if (mode === 'notify-only') {
    // Welle S2/M4 (Sarah 2026-05-27): notify-Eintrag NUR löschen, wenn die Mail
    // erfolgreich rausging (Brevo-Down darf die Subscription nicht killen). Die
    // RPC hat die Einträge bewusst NICHT gelöscht; das passiert hier on-success
    // über delete_notify_subscribers (RLS-frei, server-seitig).
    const notify = ((result as any).notify_users || []) as any[]
    const succeededUserIds: string[] = []
    for (const nu of notify) {
      const userId = nu?.user_id
      if (!nu?.email) { if (userId) succeededUserIds.push(userId); continue }
      try {
        const r = await Email.notifyPlaceFree({
          email: nu.email,
          firstName: nu.first_name || 'Yogi',
          courseName: nu.course_name || '',
          date: nu.date || '',
          timeStart: nu.time_start || '',
          sessionId: nu.session_id || sessionId,
        })
        if (r && (r as any).ok !== false && userId) succeededUserIds.push(userId)
      } catch (e) { console.error('notifyPlaceFree email:', e) }
    }
    if (succeededUserIds.length > 0) {
      try {
        await supabase.rpc('delete_notify_subscribers', {
          p_session_id: sessionId, p_user_ids: succeededUserIds,
        })
      } catch (e) { console.error('delete_notify_subscribers RPC:', e) }
    }
    return { mode: 'noop' }
  }

  // mode === 'noop' (Stunde begonnen / abgesagt / bereits vergeben) oder unbekannt
  return { mode: 'noop' }
}
