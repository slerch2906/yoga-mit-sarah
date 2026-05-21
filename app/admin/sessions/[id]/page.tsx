'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Email } from '@/lib/email'
import { isExcluded } from '@/lib/session-status'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

export default function AdminSessionPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const [session, setSession] = useState<any>(null)
  const [bookings, setBookings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [showCancelForm, setShowCancelForm] = useState(false)
  const [hasReplacement, setHasReplacement] = useState(false)
  const [replacementDate, setReplacementDate] = useState('')
  const [replacementTime, setReplacementTime] = useState('')
  const [showAddReplacement, setShowAddReplacement] = useState(false)
  const [lateReplacementDate, setLateReplacementDate] = useState('')
  const [lateReplacementTime, setLateReplacementTime] = useState('')
  const [addingReplacement, setAddingReplacement] = useState(false)
  const [showAddYogi, setShowAddYogi] = useState(false)
  const [yogiSearch, setYogiSearch] = useState('')
  const [yogiResults, setYogiResults] = useState<any[]>([])
  const [selectedYogi, setSelectedYogi] = useState<any>(null)
  const [addingYogi, setAddingYogi] = useState(false)
  const [quickCreditYogi, setQuickCreditYogi] = useState<any>(null)

  useEffect(() => { loadData() }, [id])

  async function searchYogis(q: string) {
    setYogiSearch(q)
    if (q.length < 2) { setYogiResults([]); return }
    const { data } = await supabase.from('profiles')
      .select('id, first_name, last_name, email, is_dummy, credits(*)')
      .eq('is_admin', false)
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(8)
    // Filter already booked
    const bookedIds = bookings.map((b: any) => b.user_id)
    setYogiResults((data || []).filter((y: any) => !bookedIds.includes(y.id)))
  }

  function getFreeCredits(yogi: any) {
    return (yogi.credits || []).reduce((sum: number, c: any) => {
      if (c.model === 'guthaben') return sum // Guthaben nur für Kurse, nicht Einzelstunden
      if (new Date(c.expires_at) > new Date()) return sum + Math.max(0, c.total - c.used)
      return sum
    }, 0)
  }

  function getGuthabenCredits(yogi: any): number {
    const now = new Date()
    return (yogi.credits || []).reduce((sum: number, c: any) => {
      if (c.model !== 'guthaben') return sum
      if (new Date(c.expires_at) > now) return sum + Math.max(0, c.total - c.used)
      return sum
    }, 0)
  }

  function getBestCredit(yogi: any) {
    const now = new Date()
    return (yogi.credits || [])
      .filter((c: any) => c.model !== 'guthaben' && new Date(c.expires_at) > now && (c.total - c.used) > 0)
      .sort((a: any, b: any) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())[0] || null
  }

  async function cancelBookingForYogi(bookingId: string, creditId: string | null, sessionId: string) {
    if (!confirm('Yogi aus dieser Stunde austragen und Credit zurückgeben?')) return

    await supabase.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false
    }).eq('id', bookingId)

    // credit.used wird automatisch durch trg_sync_credit_used aktualisiert

    await supabase.from('audit_log').insert({
      action: 'booking_cancelled_by_admin',
      details: { booking_id: bookingId, session_id: sessionId }
    })

    const { data: sess } = await supabase
      .from('sessions').select('date, time_start, course:courses(name)')
      .eq('id', sessionId).single()

    const { data: waitlistFirst } = await supabase.from('waitlist')
      .select('*, profile:profiles(email, first_name)')
      .eq('session_id', sessionId).eq('type', 'waitlist')
      .order('position').limit(1).maybeSingle()

    if (waitlistFirst) {
      const { data: allWaitCredits } = await supabase.from('credits')
        .select('*').eq('user_id', waitlistFirst.user_id)
        .gt('expires_at', new Date().toISOString())
      const availableCredits = (allWaitCredits || []).filter((c: any) => c.total > c.used)
      const waitCredit = availableCredits.sort((a: any, b: any) =>
        new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())[0] || null
      if (waitCredit && (waitCredit.total - waitCredit.used) > 0) {
        await supabase.from('bookings').upsert({
          user_id: waitlistFirst.user_id, session_id: sessionId, type: 'single', status: 'active',
          credit_id: waitCredit.id, cancelled_at: null, cancel_late: false,
        }, { onConflict: 'user_id,session_id' })
        // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
      }
      if (waitlistFirst.profile?.email) {
        await Email.waitlistPromoted({
          email: waitlistFirst.profile.email,
          firstName: waitlistFirst.profile.first_name || 'Yogi',
          courseName: (sess?.course as any)?.name || '',
          date: sess?.date || '',
          timeStart: sess?.time_start || '',
        })
      }
      await supabase.from('waitlist').delete().eq('id', waitlistFirst.id)
    }

    const { data: notifyUsers } = await supabase.from('waitlist')
      .select('*, profile:profiles(email, first_name)')
      .eq('session_id', sessionId).eq('type', 'notify')
    if (notifyUsers && notifyUsers.length > 0) {
      for (const nu of notifyUsers) {
        if (nu.profile?.email) {
          await Email.notifyPlaceFree({
            email: nu.profile.email,
            firstName: nu.profile.first_name || 'Yogi',
            courseName: (sess?.course as any)?.name || '',
            date: sess?.date || '',
            timeStart: sess?.time_start || '',
            sessionId,
          })
        }
      }
      await supabase.from('waitlist').delete().eq('session_id', sessionId).eq('type', 'notify')
    }

    loadData()
  }

  async function handleAddYogi(yogi: any) {
    const credit = getBestCredit(yogi)
    if (!credit) { setQuickCreditYogi(yogi); return }
    setAddingYogi(true)
    const { error: bookingError } = await supabase.from('bookings').upsert({
      user_id: yogi.id, session_id: id,
      credit_id: credit.id, type: 'single', status: 'active',
      cancelled_at: null, cancel_late: false,
    }, { onConflict: 'user_id,session_id' })
    if (bookingError) {
      setAddingYogi(false)
      alert('Buchung konnte nicht angelegt werden.')
      return
    }
    // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
    await supabase.from('audit_log').insert({
      action: 'admin_added_yogi_to_session',
      details: { user_id: yogi.id, session_id: id, credit_id: credit.id }
    })
    setShowAddYogi(false); setYogiSearch(''); setYogiResults([]); setSelectedYogi(null)
    setAddingYogi(false); loadData()
  }

  async function handleQuickCredit(yogi: any) {
    const expiry = new Date(); expiry.setFullYear(expiry.getFullYear() + 1)
    const { data: newCredit } = await supabase.from('credits').insert({
      user_id: yogi.id, total: 1, used: 1,
      expires_at: expiry.toISOString(), model: 'single', course_id: null
    }).select('id, used').single()
    if (!newCredit) return
    await supabase.from('bookings').upsert({
      user_id: yogi.id, session_id: id,
      credit_id: newCredit.id, type: 'single', status: 'active',
      cancelled_at: null, cancel_late: false,
    }, { onConflict: 'user_id,session_id' })
    setQuickCreditYogi(null); setShowAddYogi(false)
    setYogiSearch(''); setYogiResults([])
    loadData()
  }

  async function loadData() {
    const [{ data: sess }, { data: bkgs }] = await Promise.all([
      supabase.from('sessions').select('*, course:courses(name, id), replacement:sessions!sessions_replacement_session_id_fkey(id, date, time_start, is_cancelled)').eq('id', id).single(),
      supabase.from('bookings')
        .select('*, profile:profiles(email, first_name, last_name)')
        .eq('session_id', id).eq('status', 'active'),
    ])
    setSession(sess)
    setBookings(bkgs || [])
    setLoading(false)
  }

  async function handleAddLateReplacement() {
    if (!lateReplacementDate || !lateReplacementTime) return
    setAddingReplacement(true)

    // Alle stornierten Buchungen dieser Session holen
    const { data: cancelledBookings } = await supabase
      .from('bookings')
      .select('*, profile:profiles(email, first_name, last_name)')
      .eq('session_id', id)
      .eq('status', 'cancelled')

    // Neue Ersatz-Session im gleichen Kurs anlegen
    const { data: newSession } = await supabase.from('sessions').insert({
      course_id: session.course.id,
      date: lateReplacementDate,
      time_start: lateReplacementTime + ':00',
      duration_min: session.duration_min,
      is_cancelled: false,
    }).select('id').single()

    if (!newSession) { setAddingReplacement(false); return }

    // Ersatztermin mit Original verknüpfen (für "Zur Ersatzstunde"-Link bei abgesagter Stunde)
    await supabase.from('sessions').update({
      replacement_session_id: newSession.id,
    }).eq('id', id)

    let enrolledCount = 0
    let skippedCount = 0

    for (const booking of (cancelledBookings || [])) {
      if (!booking.credit_id) continue

      // Credit prüfen: muss existieren, noch gültig sein und freies Guthaben haben
      const { data: credit } = await supabase.from('credits')
        .select('*').eq('id', booking.credit_id).maybeSingle()

      const creditAvailable = credit
        && (credit.total - credit.used) > 0
        && new Date(credit.expires_at) > new Date()

      if (!creditAvailable) {
        skippedCount++
        continue
      }

      // Upsert: falls Yogi bereits eine Buchung für diese neue Session hat (Duplikat-Schutz)
      const { error: bookingError } = await supabase.from('bookings').upsert({
        user_id: booking.user_id,
        session_id: newSession.id,
        credit_id: booking.credit_id,
        type: booking.type || 'course',
        status: 'active',
        cancelled_at: null,
        cancel_late: false,
      }, { onConflict: 'user_id,session_id' })

      if (bookingError) { skippedCount++; continue }

      // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
      enrolledCount++

      if (booking.profile?.email) {
        await Email.sessionAdded({
          email: booking.profile.email,
          firstName: booking.profile.first_name || 'Yogi',
          courseName: session?.course?.name || '',
          date: lateReplacementDate,
          timeStart: lateReplacementTime,
          durationMin: session?.duration_min || 60,
          originalDate: session?.date,
          originalTime: session?.time_start,
        })
      }
    }

    await supabase.from('audit_log').insert({
      action: 'replacement_session_added',
      details: {
        original_session_id: id,
        replacement_session_id: newSession.id,
        course: session?.course?.name,
        date: lateReplacementDate,
        yogis_enrolled: enrolledCount,
        yogis_skipped: skippedCount,
      }
    })

    setAddingReplacement(false)
    setShowAddReplacement(false)
    const skipNote = skippedCount > 0
      ? ` ${skippedCount} Yogi(s) nicht eingebucht – Credit bereits in einer anderen Stunde verwendet.`
      : ''
    alert(`Ersatztermin angelegt! ${enrolledCount} Yogi(s) eingebucht und informiert.${skipNote}`)
    loadData()
  }

  async function handleCancelSession() {
    if (!confirm(`Stunde wirklich absagen? ${bookings.length} Yogis werden informiert.`)) return
    setCancelling(true)

    let replacementSessionId: string | null = null

    // 1) Ersatztermin anlegen falls gewünscht
    if (hasReplacement && replacementDate && replacementTime) {
      const { data: newSession } = await supabase.from('sessions').insert({
        course_id: session.course.id,
        date: replacementDate,
        time_start: replacementTime,
        duration_min: session.duration_min,
        is_cancelled: false,
      }).select('id').single()
      replacementSessionId = newSession?.id || null
    }

    // 2) Ursprüngliche Session als abgesagt markieren + ggf. Ersatztermin verlinken
    // WICHTIG: cancel_reason gesetzt damit UI zwischen "Abgesagt" und "Ausgeschlossen" unterscheidet.
    await supabase.from('sessions').update({
      is_cancelled: true,
      cancel_reason: reason || 'Abgesagt',
      replacement_session_id: replacementSessionId,
    }).eq('id', id)

    // 3) Alle Buchungen stornieren
    for (const booking of bookings) {
      await supabase.from('bookings').update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancel_late: false,
      }).eq('id', booking.id)

      // Credit zurückbuchen ODER direkt in Ersatztermin einbuchen
      if (replacementSessionId && booking.credit_id) {
        // Direkt in Ersatztermin einbuchen – Credit bleibt verbraucht
        await supabase.from('bookings').insert({
          user_id: booking.user_id,
          session_id: replacementSessionId,
          credit_id: booking.credit_id,
          type: booking.type,
          status: 'active',
        })
      }
      // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
      // (bei Cancellation und/oder neuer Buchung im Ersatztermin)

      // Email an Yogi
      if (booking.profile?.email) {
        await Email.sessionCancelled({
          email: booking.profile.email,
          firstName: booking.profile.first_name || 'Yogi',
          courseName: session?.course?.name || '',
          date: session?.date || '',
          timeStart: session?.time_start || '',
          reason: reason || undefined,
          replacementDate: hasReplacement ? replacementDate : undefined,
          replacementTime: hasReplacement ? replacementTime : undefined,
        })

        // Falls Ersatztermin: auch Buchungsbestätigung für neuen Termin
        if (replacementSessionId) {
          await Email.bookingConfirmed({
            email: booking.profile.email,
            firstName: booking.profile.first_name || 'Yogi',
            courseName: session?.course?.name || '',
            date: replacementDate,
            timeStart: replacementTime,
            durationMin: session?.duration_min || 60,
          })
        }
      }
    }

    // 4) Warteliste löschen
    await supabase.from('waitlist').delete().eq('session_id', id)

    setCancelling(false)
    const msg = replacementSessionId
      ? `Stunde abgesagt. ${bookings.length} Yogis wurden direkt in den Ersatztermin (${replacementDate}) eingebucht und informiert.`
      : `Stunde abgesagt. ${bookings.length} Yogis wurden informiert und ihre Credits zurückgebucht.`
    alert(msg)
    router.back()
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" />
    </div>
  )

  const dateStr = session?.date ? new Date(session.date).toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }) : ''

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Stunde verwalten" isAdmin />
      <div className="px-4 py-4">

        {/* Session Info */}
        <div className="card mb-4">
          <div className="text-base font-bold mb-1">{session?.course?.name}</div>
          <div className="text-sm text-yoga-text/60">{dateStr} · {session?.time_start?.slice(0,5)} Uhr</div>
          <div className="text-sm text-yoga-text/50 mt-1">{session?.duration_min} Minuten</div>
          {session?.is_cancelled && (
            <div className={`mt-2 text-sm font-semibold ${isExcluded(session) ? 'text-yoga-text/50' : 'text-yoga-red-text'}`}>
              {isExcluded(session) ? 'Diese Stunde ist ausgeschlossen (zählt nicht als Einheit)' : 'Diese Stunde ist bereits abgesagt'}
            </div>
          )}
        </div>

        {/* Eingebuchte Yogis */}
        <p className="section-label">Eingebuchte Yogis ({bookings.length})</p>
        {bookings.length === 0 ? (
          <p className="text-sm text-yoga-text/40 text-center py-4">Keine Buchungen</p>
        ) : (
          <div className="card mb-4 p-0 overflow-hidden">
            {bookings.map((b, i) => (
              <div key={b.id}
                className={`px-4 py-3 flex items-center justify-between gap-2 ${i < bookings.length - 1 ? 'border-b border-yoga-border' : ''}`}>
                <div>
                  <div className="text-sm font-semibold">
                    {b.profile?.first_name} {b.profile?.last_name}
                  </div>
                  <div className="text-xs text-yoga-text/50">{b.profile?.email}</div>
                </div>
                {!session?.is_cancelled && (
                  <button onClick={() => cancelBookingForYogi(b.id, b.credit_id, id)}
                    className="text-xs bg-yoga-red-bg text-yoga-red-text border-0 rounded-full px-2.5 py-1 cursor-pointer font-semibold flex-shrink-0">
                    Austragen
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Yogi hinzufügen */}
        {!session?.is_cancelled && (
          <button onClick={() => { setShowAddYogi(true); setYogiSearch(''); setYogiResults([]) }}
            className="w-full btn-secondary flex items-center justify-center gap-2 text-sm mb-4">
            <i className="ti ti-user-plus" />Yogi hinzufügen
          </button>
        )}

        {/* Absage-Bereich */}
        {/* Ersatztermin nachträglich anlegen (nur wenn bereits abgesagt) */}
        {session?.is_cancelled && (
          <div className="card border-yoga-amber-text/20 bg-yoga-amber-bg mb-4">
            <p className="text-sm font-bold text-yoga-amber-text mb-1">Stunde ist abgesagt</p>
            {/* Link zum bereits verknüpften Ersatztermin (wenn vorhanden) */}
            {(session as any).replacement && !(session as any).replacement.is_cancelled && (
              <button onClick={() => router.push(`/admin/sessions/${(session as any).replacement.id}`)}
                className="w-full mt-2 mb-2 btn-primary text-sm">
                <i className="ti ti-calendar-event mr-1" />
                Zur Ersatzstunde: {new Date((session as any).replacement.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })} · {(session as any).replacement.time_start?.slice(0,5)} Uhr
              </button>
            )}
            {!showAddReplacement && !(session as any).replacement ? (
              <button onClick={() => setShowAddReplacement(true)}
                className="w-full mt-2 text-sm border border-yoga-amber-text/30 text-yoga-amber-text rounded-yoga py-2 font-semibold bg-transparent cursor-pointer hover:opacity-80">
                <i className="ti ti-calendar-plus mr-2" />Ersatztermin nachträglich anlegen
              </button>
            ) : !showAddReplacement ? null : (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-yoga-text/60">
                  Alle damals angemeldeten Yogis werden automatisch eingebucht und per E-Mail informiert.
                </p>
                <div>
                  <label className="field-label">Datum</label>
                  <input type="date" className="field-input" value={lateReplacementDate}
                    onChange={e => setLateReplacementDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]} />
                </div>
                <div>
                  <label className="field-label">Uhrzeit</label>
                  <input type="time" className="field-input" value={lateReplacementTime}
                    onChange={e => setLateReplacementTime(e.target.value)} />
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setShowAddReplacement(false)} className="btn-ghost flex-1 text-sm">Abbrechen</button>
                  <button onClick={handleAddLateReplacement}
                    disabled={addingReplacement || !lateReplacementDate || !lateReplacementTime}
                    className="flex-1 btn-primary text-sm disabled:opacity-40">
                    {addingReplacement ? 'Wird angelegt...' : 'Ersatztermin anlegen'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!session?.is_cancelled && (
          <>
            {!showCancelForm ? (
              <button onClick={() => setShowCancelForm(true)}
                className="w-full bg-yoga-red-bg text-yoga-red-text border border-yoga-red-text/20 rounded-yoga py-3 font-semibold text-sm cursor-pointer hover:opacity-80">
                <i className="ti ti-x mr-2" />Stunde absagen
              </button>
            ) : (
              <div className="card border-yoga-red-text/20">
                <p className="text-sm font-bold text-yoga-red-text mb-3">Stunde absagen</p>

                {/* Grund */}
                <label className="field-label">Grund (optional, erscheint in der Email)</label>
                <input className="field-input mb-4" value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="z.B. Krankheit, persönlicher Grund..." />

                {/* Ersatztermin */}
                <div className="mb-4">
                  <label className="flex items-center gap-3 cursor-pointer mb-3">
                    <input type="checkbox" checked={hasReplacement}
                      onChange={e => setHasReplacement(e.target.checked)}
                      className="w-5 h-5 flex-shrink-0" />
                    <span className="text-sm font-semibold">Ersatztermin anbieten</span>
                  </label>

                  {hasReplacement && (
                    <div className="bg-yoga-bg rounded-yoga p-3 space-y-2">
                      <p className="text-xs text-yoga-text/50 mb-2">
                        Yogis werden direkt in den Ersatztermin eingebucht – ihr Credit bleibt verbraucht.
                      </p>
                      <div>
                        <label className="field-label">Datum</label>
                        <input type="date" className="field-input" value={replacementDate}
                          onChange={e => setReplacementDate(e.target.value)}
                          min={new Date().toISOString().split('T')[0]} />
                      </div>
                      <div>
                        <label className="field-label">Uhrzeit</label>
                        <input type="time" className="field-input" value={replacementTime}
                          onChange={e => setReplacementTime(e.target.value)} />
                      </div>
                    </div>
                  )}

                  {!hasReplacement && (
                    <p className="text-xs text-yoga-text/50">
                      Ohne Ersatztermin: Credits werden an alle Yogis zurückgebucht.
                    </p>
                  )}
                </div>

                {/* Validation */}
                {hasReplacement && (!replacementDate || !replacementTime) && (
                  <p className="text-xs text-yoga-red-text mb-3">
                    Bitte Datum und Uhrzeit für den Ersatztermin eingeben.
                  </p>
                )}

                <div className="flex gap-2">
                  <button onClick={() => setShowCancelForm(false)} className="btn-ghost flex-1 text-sm">
                    Abbrechen
                  </button>
                  <button
                    onClick={handleCancelSession}
                    disabled={cancelling || (hasReplacement && (!replacementDate || !replacementTime))}
                    className="flex-1 bg-yoga-red-text text-white rounded-yoga py-2.5 text-sm font-bold border-0 cursor-pointer disabled:opacity-40">
                    {cancelling ? 'Wird abgesagt...' : 'Absagen'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {/* Yogi hinzufügen Modal */}
      {showAddYogi && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setShowAddYogi(false)}>
          <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">Yogi hinzufügen</h3>
              <button onClick={() => setShowAddYogi(false)} className="bg-transparent border-0 cursor-pointer text-yoga-text/40">
                <i className="ti ti-x text-xl" />
              </button>
            </div>
            <input className="field-input mb-3" placeholder="Name oder E-Mail eingeben..."
              value={yogiSearch} autoFocus
              onChange={e => searchYogis(e.target.value)} />
            {yogiSearch.length >= 2 && yogiResults.length === 0 && (
              <p className="text-sm text-yoga-text/40 text-center py-3">Kein Yogi gefunden</p>
            )}
            {yogiResults.map(yogi => {
              const free = getFreeCredits(yogi)
              const guthaben = getGuthabenCredits(yogi)
              return (
                <div key={yogi.id} className="flex items-center justify-between py-3 border-b border-yoga-border">
                  <div>
                    <div className="text-sm font-semibold">
                      {yogi.first_name} {yogi.last_name}
                      {yogi.is_dummy && <span className="ml-2 text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">Dummy</span>}
                    </div>
                    <div className="text-xs text-yoga-text/50">{yogi.email || 'Kein Login'}</div>
                    {guthaben > 0 && free === 0 && (
                      <div className="text-xs text-yoga-amber-text mt-0.5">
                        {guthaben} Guthaben – nur für Kurse verwendbar
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${free > 0 ? 'text-yoga-green-text' : 'text-yoga-red-text'}`}>
                      {free} Credits
                    </span>
                    <button onClick={() => handleAddYogi(yogi)} disabled={addingYogi}
                      className="text-xs bg-yoga-text text-yoga-bg rounded-full px-3 py-1.5 font-semibold border-0 cursor-pointer">
                      Einbuchen
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Quick Credit Modal */}
      {quickCreditYogi && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
          <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10">
            {getGuthabenCredits(quickCreditYogi) > 0 ? (
              <>
                <h3 className="text-base font-bold mb-2">Nur Kurs-Guthaben vorhanden</h3>
                <p className="text-sm text-yoga-text/60 mb-4">
                  <strong>{quickCreditYogi.first_name} {quickCreditYogi.last_name}</strong> hat {getGuthabenCredits(quickCreditYogi)} Guthaben aus einem abgesagten Kurs. Dieses Guthaben kann <strong>nur für neue Kurse</strong> verwendet werden, nicht für Einzelstunden.
                </p>
                <button onClick={() => setQuickCreditYogi(null)}
                  className="w-full btn-secondary text-sm">Schließen</button>
              </>
            ) : (
              <>
                <h3 className="text-base font-bold mb-2">Keine Credits vorhanden</h3>
                <p className="text-sm text-yoga-text/60 mb-4">
                  <strong>{quickCreditYogi.first_name} {quickCreditYogi.last_name}</strong> hat keine freien Credits.
                  Soll ein Einzelstunden-Credit vergeben und direkt eingebucht werden?
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setQuickCreditYogi(null)}
                    className="flex-1 btn-secondary text-sm">Abbrechen</button>
                  <button onClick={() => handleQuickCredit(quickCreditYogi)}
                    className="flex-1 btn-primary text-sm">Credit vergeben & einbuchen</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <BottomNav isAdmin />
    </div>
  )
}
