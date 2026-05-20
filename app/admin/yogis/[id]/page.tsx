'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Email } from '@/lib/email'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

export default function AdminYogiDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [yogi, setYogi] = useState<any>(null)
  const [bookings, setBookings] = useState<any[]>([])
  const [credits, setCredits] = useState<any[]>([])
  const [enrollments, setEnrollments] = useState<any[]>([])
  const [courses, setCourses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState<string | null>(null)
  const [showEnrollForm, setShowEnrollForm] = useState(false)
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [enrolling, setEnrolling] = useState(false)
  const [editingCredit, setEditingCredit] = useState<any>(null)
  const [editCreditAmount, setEditCreditAmount] = useState(0)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { loadData() }, [id])

  async function loadData() {
    const [{ data: y }, { data: b }, { data: c }, { data: e }, { data: courseList }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', id).single(),
      supabase.from('bookings')
        .select('*, session:sessions(date, time_start, course:courses(name))')
        .eq('user_id', id).order('created_at', { ascending: false }).limit(20),
      supabase.from('credits').select('*, course:courses(name)').eq('user_id', id).order('created_at', { ascending: false }),
      supabase.from('enrollments').select('*, course:courses(*)').eq('user_id', id),
      supabase.from('courses').select('*, sessions(date), enrollments(id)').eq('is_active', true).order('name'),
    ])
    setYogi(y); setBookings(b || []); setCredits(c || [])
    setEnrollments(e || []); setCourses(courseList || [])
    setLoading(false)
  }

  const freeCredits = credits.reduce((sum, c) => {
    if (new Date(c.expires_at) > new Date()) return sum + Math.max(0, c.total - c.used)
    return sum
  }, 0)

  function getRemainingUnits(course: any) {
    const today = new Date()
    return (course.sessions || []).filter((s: any) => new Date(s.date) >= today).length
  }

  function getExpiryDate(course: any) {
    const dates = (course.sessions || []).map((s: any) => new Date(s.date))
    if (dates.length === 0) return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    const last = new Date(Math.max(...dates.map((d: Date) => d.getTime())))
    last.setDate(last.getDate() + 8)
    return last
  }

  async function handleDeleteYogi() {
    if (!confirm(`Account von ${yogi?.first_name} ${yogi?.last_name} DSGVO-konform anonymisieren? Buchungshistorie bleibt anonym erhalten.`)) return
    if (!confirm('Bist du sicher? Diese Aktion kann nicht rückgängig gemacht werden!')) return

    const fullName = `${yogi?.first_name || ''} ${yogi?.last_name || ''}`.trim()
    const email = yogi?.email || ''

    // DSGVO: Anonymisieren statt hart löschen
    await supabase.from('profiles').update({
      first_name: 'Gelöschter',
      last_name: 'Nutzer',
      email: null,
      emergency_name: null,
      emergency_phone: null,
      legal_accepted_at: null,
    }).eq('id', id)

    await supabase.from('legal_acceptances').update({
      full_name: 'Gelöschter Nutzer',
      ip_address: null,
      user_agent: null,
      emergency_contact: null,
      phone: null,
    }).eq('user_id', id)

    // Warteliste entfernen
    await supabase.from('waitlist').delete().eq('user_id', id)

    // Auth User löschen + Sessions invalidieren
    try {
      const deleteRes = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id })
      })
      if (!deleteRes.ok) {
        // Kein Alert - Profil ist anonymisiert, Auth-Löschung ist sekundär
        const err = await deleteRes.json().catch(() => ({}))
        console.error('Delete account failed (non-critical):', err)
      }
    } catch (e) {
      console.error('Delete account error:', e)
    }

    await supabase.from('audit_log').insert({
      action: 'yogi_anonymized_dsgvo',
      details: { anonymized_user_id: id, original_email: email, original_name: fullName }
    })

    // Email an dich: Drive-PDF löschen
    const { data: { session: sess } } = await supabase.auth.getSession()
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sess?.access_token}` },
      body: JSON.stringify({ type: 'admin_dsgvo_deletion', data: { fullName, email } })
    }).catch(() => {})

    router.push('/admin/yogis')
  }

  async function handleEnroll() {
    if (!selectedCourseId) return
    setEnrolling(true)
    const course = courses.find(c => c.id === selectedCourseId)
    const remaining = getRemainingUnits(course)
    const expiry = getExpiryDate(course)

    // Prüfen ob Kurs bereits voll
    const { count } = await supabase
      .from('enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('course_id', selectedCourseId)
    // Dummy-User dürfen auch in volle Kurse als Platzhalter
    if (course?.max_spots && (count ?? 0) >= course.max_spots && !yogi?.is_dummy) {
      alert(`Kurs ist bereits voll (max. ${course.max_spots} Teilnehmer).`)
      setEnrolling(false)
      return
    }

    // Guthaben-Credits prüfen
    const { data: guthabenCredits } = await supabase.from('credits')
      .select('*').eq('user_id', id).eq('model', 'guthaben')
      .gt('used', -1).order('expires_at')
    const availableGuthaben = (guthabenCredits || []).filter(g => (g.total - g.used) > 0)
    const totalGuthaben = availableGuthaben.reduce((s: number, g: any) => s + (g.total - g.used), 0)

    if (availableGuthaben.length > 0) {
      const useGuthaben = confirm(
        `${yogi?.first_name} hat ${totalGuthaben} Guthaben-Credits aus einem abgesagten Kurs.

` +
        `Folgekurs hat ${remaining} Stunden.

` +
        `Guthaben verwenden? → ${Math.max(0, remaining - totalGuthaben)} neue Credits nötig.
` +
        `(Abbrechen = nur neue Credits vergeben)`
      )
      if (useGuthaben) {
        // Guthaben aufbrauchen
        let needed = remaining
        for (const g of availableGuthaben) {
          if (needed <= 0) break
          const free = g.total - g.used
          const use = Math.min(free, needed)
          await supabase.from('credits').update({ used: g.used + use }).eq('id', g.id)
          needed -= use
        }
        // Verbleibende als neue Credits
        if (needed > 0) {
          await supabase.from('credits').insert({
            user_id: id, course_id: selectedCourseId,
            model: 'course', total: needed, used: 0,
            expires_at: expiry.toISOString()
          })
        } else {
          // Alle durch Guthaben gedeckt - Enrollment trotzdem anlegen
        }
        await supabase.from('enrollments').upsert({ user_id: id, course_id: selectedCourseId, enrolled_from_unit: 1 })
        // Sessions buchen + Email + loadData (früher Abschluss)
        const { data: sessions2 } = await supabase.from('sessions').select('id')
          .eq('course_id', selectedCourseId).gte('date', new Date().toISOString().split('T')[0])
        for (const s of (sessions2 || [])) {
          const { data: ex } = await supabase.from('bookings').select('id')
            .eq('user_id', id).eq('session_id', s.id).maybeSingle()
          if (!ex) await supabase.from('bookings').insert({ user_id: id, session_id: s.id, type: 'course', status: 'active' })
        }
        const { data: yProf2 } = await supabase.from('profiles').select('email, first_name').eq('id', id).single()
        if (yProf2?.email && course && !yogi?.is_dummy) {
          await Email.yogiEnrolledByAdmin({ email: yProf2.email, firstName: yProf2.first_name || 'Yogi',
            courseName: course.name, weekday: course.weekday, timeStart: course.time_start,
            durationMin: course.duration_min || 75, totalUnits: remaining, dateStart: course.date_start })
        }
        setEnrolling(false); loadData(); return
      }
      // useGuthaben = false → normal weiter unten
    } // end if (availableGuthaben.length > 0)

    await supabase.from('enrollments').upsert({ user_id: id, course_id: selectedCourseId, enrolled_from_unit: 1 })

    // Zuerst Sessions laden um genaue Anzahl zu kennen
    const { data: sessions } = await supabase.from('sessions').select('id')
      .eq('course_id', selectedCourseId)
      .gte('date', new Date().toISOString().split('T')[0])
      .eq('is_cancelled', false)

    const actualCount = sessions?.length || 0

    // Credits anlegen: used = actualCount (sofort alle verbraucht, da sofort eingebucht)
    // Wenn Yogi sich aus einer Stunde austrägt: used -1 → Credit wird frei
    // Wenn Yogi sich wieder einträgt: used +1 → Credit verbraucht
    const { data: credit } = await supabase.from('credits').insert({
      user_id: id, course_id: selectedCourseId, model: 'course',
      total: actualCount, used: actualCount, expires_at: expiry.toISOString(),
    }).select().single()

    if (actualCount > 0 && sessions) {
      // Für jede Session: bestehende Buchung reaktivieren ODER neue anlegen
      for (const s of sessions) {
        const { data: existing } = await supabase.from('bookings')
          .select('id').eq('session_id', s.id).eq('user_id', id).maybeSingle()
        if (existing) {
          await supabase.from('bookings').update({
            status: 'active', credit_id: credit?.id || null,
            cancelled_at: null, cancel_late: false, type: 'course'
          }).eq('id', existing.id)
        } else {
          await supabase.from('bookings').insert({
            user_id: id, session_id: s.id,
            credit_id: credit?.id || null, type: 'course', status: 'active'
          })
        }
      }
    }

    // Email: Kurs-Einbuchung durch Admin
    try {
      const { data: yProf } = await supabase.from('profiles').select('email, first_name').eq('id', id).single()
      const { data: crs } = await supabase.from('courses').select('name, weekday, time_start, duration_min, total_units, date_start').eq('id', selectedCourseId).single()
      if (yProf?.email && crs && !yProf.is_dummy) {
        await Email.yogiEnrolledByAdmin({
          email: yProf.email,
          firstName: yProf.first_name || 'Yogi',
          courseName: crs.name || '',
          weekday: crs.weekday || '',
          timeStart: crs.time_start || '',
          durationMin: crs.duration_min || 75,
          totalUnits: crs.total_units || undefined,
          dateStart: crs.date_start || undefined,
        })
      }
    } catch(e) {}

    await supabase.from('audit_log').insert({
      action: 'yogi_enrolled_by_admin',
      details: { target_user_id: id, course_id: selectedCourseId, credits: remaining }
    })

    setShowEnrollForm(false); setSelectedCourseId('')
    loadData(); setEnrolling(false)
  }

  async function removeFromCourse(enrollmentId: string, courseId: string) {
    // Nur Kurs-Credits löschen (nach course_id) – Punktekarte IMMER behalten
    const { data: sessions } = await supabase.from('sessions').select('id').eq('course_id', courseId)
    const sessionIds = (sessions || []).map((s: any) => s.id)

    if (sessionIds.length > 0) {
      await supabase.from('bookings').update({
        status: 'cancelled', cancelled_at: new Date().toISOString()
      }).eq('user_id', id).in('session_id', sessionIds).eq('status', 'active')

      // Für jede Session: Warteliste + Notify prüfen
      for (const sid of sessionIds) {
        try {
          const { data: sess } = await supabase.from('sessions')
            .select('date, time_start, course:courses(name)').eq('id', sid).single()

          const { data: wFirst } = await supabase.from('waitlist')
            .select('*, profile:profiles(email, first_name)')
            .eq('session_id', sid).eq('type', 'waitlist')
            .order('position').limit(1).single()
          if (wFirst?.profile) {
            await Email.waitlistPromoted({
              email: wFirst.profile.email, firstName: wFirst.profile.first_name || 'Yogi',
              courseName: sess?.course?.name || '', date: sess?.date || '', timeStart: sess?.time_start || '',
            })
            await supabase.from('waitlist').delete().eq('id', wFirst.id)
          }

          const { data: notifyUsers } = await supabase.from('waitlist')
            .select('*, profile:profiles(email, first_name)')
            .eq('session_id', sid).eq('type', 'notify')
          if (notifyUsers?.length) {
            for (const nu of notifyUsers) {
              if (nu.profile) await Email.notifyPlaceFree({
                email: nu.profile.email, firstName: nu.profile.first_name || 'Yogi',
                courseName: sess?.course?.name || '', date: sess?.date || '',
                timeStart: sess?.time_start || '', sessionId: sid,
              })
            }
            await supabase.from('waitlist').delete().eq('session_id', sid).eq('type', 'notify')
          }
        } catch(e) {}
      }
    }

    // Zuerst Bookings entkoppeln (Foreign Key auf credits), dann Credits löschen
    const { data: courseCredits } = await supabase.from('credits')
      .select('id').eq('user_id', id).eq('course_id', courseId)
    if (courseCredits && courseCredits.length > 0) {
      const creditIds = courseCredits.map((c: any) => c.id)
      await supabase.from('bookings').update({ credit_id: null })
        .eq('user_id', id).in('credit_id', creditIds)
      await supabase.from('credits').delete()
        .eq('user_id', id).eq('course_id', courseId)
    }

    await supabase.from('enrollments').delete().eq('id', enrollmentId)
    await supabase.from('audit_log').insert({
      action: 'yogi_removed_from_course',
      details: { target_user_id: id, course_id: courseId, delete_credits: true }
    })
    setRemoving(null); loadData()
  }

  async function handleEditCredit(credit: any, newTotal: number) {
    if (newTotal < credit.used) {
      alert(`Mindestens ${credit.used} Credits nötig (bereits verbraucht).`)
      return
    }
    await supabase.from('credits').update({ total: newTotal }).eq('id', credit.id)
    await supabase.from('audit_log').insert({
      action: 'credit_adjusted',
      details: { target_user_id: id, credit_id: credit.id, old_total: credit.total, new_total: newTotal }
    })
    setEditingCredit(null); loadData()
  }

  async function handleDeleteCredit(creditId: string) {
    if (!confirm('Diese Credits komplett löschen?')) return
    await supabase.from('credits').delete().eq('id', creditId)
    await supabase.from('audit_log').insert({
      action: 'credit_deleted',
      details: { target_user_id: id, credit_id: creditId }
    })
    loadData()
  }

  function getStatusBadge(b: any) {
    if (b.status === 'cancelled') return <span className="badge badge-left">Ausgetragen</span>
    if (new Date(b.session?.date) < new Date()) return <span className="badge badge-done">Teilgenommen </span>
    return <span className="badge badge-enrolled">Angemeldet</span>
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>
  if (!yogi) return null

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title={`${yogi.first_name} ${yogi.last_name}`} isAdmin />
      <div className="px-4 py-4">

        {/* Zurück */}
        <button onClick={() => router.back()}
          className="flex items-center gap-1 text-sm text-yoga-text/60 mb-4 hover:opacity-80">
          <i className="ti ti-arrow-left" /> Zurück
        </button>

        <div className="card mb-4">
          {yogi.is_dummy && (
            <span className="badge bg-yoga-amber-bg text-yoga-amber-text mb-2 inline-block">
              <i className="ti ti-user-question mr-1" />Dummy-User (kein Login)
            </span>
          )}
          <p className="text-sm font-semibold">{yogi.email || 'Keine E-Mail'}</p>
          <p className="text-xs text-yoga-text/40 mt-1">
            Dabei seit {new Date(yogi.created_at).toLocaleDateString('de-DE', { month:'long', year:'numeric' })}
          </p>
          {(yogi.emergency_name || yogi.emergency_phone) && (
            <div className="mt-2 p-2 bg-yoga-amber-bg/40 rounded-yoga border border-yoga-amber-text/20">
              <div className="text-xs text-yoga-text/50 mb-1"> Notfallkontakt</div>
              {yogi.emergency_name && <div className="text-sm font-semibold">{yogi.emergency_name}</div>}
              {yogi.emergency_phone && <div className="text-sm text-yoga-text/70">{yogi.emergency_phone}</div>}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            {yogi.legal_accepted_at ? (
              <span className="text-xs bg-yoga-green-bg text-yoga-green-text px-2 py-0.5 rounded-full font-semibold">
                <i className="ti ti-check mr-0.5" />AGB akzeptiert am {new Date(yogi.legal_accepted_at).toLocaleDateString('de-DE')}
              </span>
            ) : (
              <span className="text-xs bg-yoga-amber-bg text-yoga-amber-text px-2 py-0.5 rounded-full font-semibold">
                <i className="ti ti-alert-triangle mr-0.5" />AGB noch nicht akzeptiert
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="card text-center">
            <div className="text-2xl font-bold">{freeCredits}</div>
            <div className="text-xs text-yoga-text/50">Freie Credits</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold">
              {bookings.filter(b => b.status === 'active' && new Date(b.session?.date) < new Date()).length}
            </div>
            <div className="text-xs text-yoga-text/50">Absolvierte Stunden</div>
          </div>
        </div>

        {/* Aktionen */}
        <div className="flex gap-2 mb-5">
          <button onClick={() => setShowEnrollForm(!showEnrollForm)} className="flex-1 btn-primary text-sm py-3">
            <i className="ti ti-calendar-plus mr-1" /> In Kurs einbuchen
          </button>
          <button onClick={() => router.push(`/admin/credits?user=${id}`)} className="flex-1 btn-secondary text-sm py-3">
            <i className="ti ti-coin mr-1" /> Credits vergeben
          </button>
        </div>

        {/* Einbuch-Formular */}
        {showEnrollForm && (
          <div className="card mb-4" style={{ background: '#e8ede6', borderColor: 'rgba(58,90,48,0.2)' }}>
            <p className="text-sm font-bold mb-2" style={{ color: '#3a5a30' }}>Direkt in Kurs einbuchen</p>
            <p className="text-xs mb-3" style={{ color: '#3a5a30', opacity: 0.8 }}>
              Credits werden automatisch berechnet. Verfall: 8 Tage nach letzter Stunde.
            </p>
            <select className="field-input mb-3" value={selectedCourseId} onChange={e => setSelectedCourseId(e.target.value)}>
              <option value="">Kurs wählen...</option>
              {courses.filter(c => !enrollments.find(e => e.course_id === c.id)).map(c => {
                const rem = getRemainingUnits(c)
                const enrollCount = c.enrollments?.length ?? 0
                const isFull = c.max_spots && enrollCount >= c.max_spots
                return (
                  <option key={c.id} value={c.id} disabled={!!isFull}>
                    {isFull ? ` ${c.name} (voll – ${enrollCount}/${c.max_spots})` : `${c.name} → ${rem} Credits · ${enrollCount}/${c.max_spots ?? '∞'} Plätze`}
                  </option>
                )
              })}
            </select>
            <div className="flex gap-2">
              <button onClick={handleEnroll} disabled={!selectedCourseId || enrolling}
                className={`flex-1 btn-primary text-sm py-2.5 ${!selectedCourseId ? 'opacity-40 cursor-not-allowed' : ''}`}>
                {enrolling ? 'Wird eingebucht...' : 'Einbuchen & Credits vergeben'}
              </button>
              <button onClick={() => setShowEnrollForm(false)} className="btn-ghost text-sm py-2.5 w-auto px-4">Abbrechen</button>
            </div>
          </div>
        )}

        {/* Eingebuchte Kurse */}
        {enrollments.length > 0 && (
          <>
            <p className="section-label">Eingebuchte Kurse</p>
            {enrollments.map(e => (
              <div key={e.id} className="card mb-3">
                <div className="text-base font-bold mb-1">{e.course?.name}</div>
                <div className="text-sm text-yoga-text/50 mb-3">{e.course?.weekday}</div>
                {removing === e.course_id ? (
                  <div className="bg-yoga-red-bg rounded-yoga p-3 border border-yoga-red-text/20">
                    <p className="text-sm font-bold text-yoga-red-text mb-2">Wirklich austragen?</p>
                    <p className="text-xs text-yoga-red-text/80 mb-3">Der Yogi wird aus dem Kurs ausgetragen und alle zugehörigen Credits werden gelöscht.</p>
                    <div className="flex gap-2">
                      <button onClick={() => setRemoving(null)}
                        className="flex-1 text-sm py-2 rounded-yoga border-0 cursor-pointer bg-yoga-gray text-yoga-text font-semibold">
                        Abbrechen
                      </button>
                      <button onClick={() => removeFromCourse(e.id, e.course_id)}
                        className="flex-1 text-sm font-bold py-2 rounded-yoga border-0 cursor-pointer"
                        style={{ background: '#6b2a2a', color: 'white' }}>
                        Ja, austragen
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setRemoving(e.course_id)}
                    className="w-full text-sm text-yoga-red-text bg-yoga-red-bg border-0 rounded-yoga py-2 cursor-pointer font-semibold hover:opacity-80">
                    Aus Kurs austragen
                  </button>
                )}
              </div>
            ))}
          </>
        )}

        {/* Credits */}
        {credits.length > 0 && (
          <>
            <p className="section-label mt-2">Credits verwalten</p>
            {credits.map(c => {
              const free = Math.max(0, c.total - c.used)
              const isExpired = new Date(c.expires_at) < new Date()
              return (
                <div key={c.id} className={`card mb-2 ${isExpired ? 'opacity-50' : ''}`}>
                  {editingCredit?.id === c.id ? (
                    <div>
                      <p className="text-sm font-semibold mb-2">Credits anpassen</p>
                      <p className="text-xs text-yoga-text/50 mb-2">Bereits verbraucht: {c.used}</p>
                      <div className="flex items-center gap-2 mb-2">
                        <label className="text-xs text-yoga-text/60">Neue Gesamtzahl:</label>
                        <input type="number" min={c.used} max={100} value={editCreditAmount}
                          onChange={e => setEditCreditAmount(parseInt(e.target.value))}
                          className="field-input w-20 text-center py-1" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleEditCredit(c, editCreditAmount)}
                          className="flex-1 btn-primary text-sm py-2">Speichern</button>
                        <button onClick={() => setEditingCredit(null)}
                          className="flex-1 btn-ghost text-sm py-2">Abbrechen</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm font-semibold">
                          {free} von {c.total} Credits frei
                        </div>
                        <div className="text-xs text-yoga-text/50 mt-0.5">
                          {c.model === 'course' ? `Kurs: ${c.course?.name || '—'}` : c.model === 'tenpack' ? 'Punktekarte' : 'Quartal'} ·
                          {isExpired ? ' Abgelaufen' : ` verfällt ${new Date(c.expires_at).getFullYear() > 2090 ? 'nie' : new Date(c.expires_at).toLocaleDateString('de-DE')}`}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => { setEditingCredit(c); setEditCreditAmount(c.total) }}
                          className="text-xs border border-yoga-border2 rounded-full px-2 py-1 hover:opacity-80">
                          <i className="ti ti-edit" />
                        </button>
                        <button onClick={() => handleDeleteCredit(c.id)}
                          className="text-xs bg-yoga-red-bg text-yoga-red-text border-0 rounded-full px-2 py-1 cursor-pointer hover:opacity-80">
                          <i className="ti ti-trash" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}

        {/* Yogi löschen */}
        <div className="mt-6 pt-4 border-t border-yoga-border">
          <button onClick={handleDeleteYogi}
            className="w-full text-sm text-yoga-red-text py-3 border border-yoga-red-bg rounded-yoga cursor-pointer hover:opacity-80 font-semibold">
            <i className="ti ti-trash mr-1" /> Yogi-Account löschen
          </button>
        </div>

        {/* Buchungshistorie */}
        {bookings.length > 0 && (
          <>
            <p className="section-label mt-2">Letzte Buchungen</p>
            {bookings.slice(0, 10).map(b => (
              <div key={b.id} className="card mb-2 flex items-center gap-2.5">
                <div className="flex-shrink-0 w-20">
                  <div className="text-sm font-bold">
                    {b.session?.date ? new Date(b.session.date).toLocaleDateString('de-DE', { day:'numeric', month:'short' }) : '—'}
                  </div>
                  <div className="text-xs text-yoga-text/50">{b.session?.time_start?.slice(0,5)}</div>
                </div>
                <div className="w-px h-6 bg-yoga-border2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{b.session?.course?.name}</div>
                  <div className="text-xs text-yoga-text/40">{b.type === 'single' ? 'Einzelstunde' : 'Kursstunde'}</div>
                </div>
                {getStatusBadge(b)}
              </div>
            ))}
          </>
        )}
      </div>
      <BottomNav isAdmin />
    </div>
  )
}
