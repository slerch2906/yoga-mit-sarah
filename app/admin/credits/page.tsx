'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { countActiveFutureUnits, isActive } from '@/lib/session-status'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

function CreditsVergebenInner() {
  const searchParams = useSearchParams()
  const userId = searchParams.get('user')
  const [targetUser, setTargetUser] = useState<any>(null)
  const [courses, setCourses] = useState<any[]>([])
  const [model, setModel] = useState<'course' | 'tenpack' | 'quarterly'>('tenpack')
  const [amount, setAmount] = useState(10)
  const [courseId, setCourseId] = useState('')
  const [expiryMode, setExpiryMode] = useState<'auto' | 'custom' | 'never'>('auto')
  const [customExpiry, setCustomExpiry] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { loadData() }, [userId])

  async function loadData() {
    const [{ data: target }, { data: courseList }] = await Promise.all([
      userId ? supabase.from('profiles').select('*').eq('id', userId).single() : Promise.resolve({ data: null }),
      supabase.from('courses').select('id, name, total_units, is_single, sessions(date, is_cancelled, cancel_reason)').eq('is_active', true).order('name'),
    ])
    setTargetUser(target)
    setCourses(courseList || [])
  }

  function getRemainingUnits(course: any) {
    // Einzelstunde: immer 1 Credit
    if (course.is_single) return 1
    // Nur AKTIVE zukünftige Sessions zählen (Single Source of Truth in lib/session-status.ts)
    return countActiveFutureUnits(course?.sessions)
  }

  function getAutoExpiry(course: any): string {
    // Ablaufdatum aus AKTIVEN Sessions berechnen (excluded/cancelled ignorieren –
    // sonst kann ein excluded späterer Termin das expires_at verschieben).
    const dates = (course.sessions || []).filter(isActive).map((s: any) => new Date(s.date))
    if (dates.length === 0) return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    const last = new Date(Math.max(...dates.map((d: Date) => d.getTime())))
    last.setDate(last.getDate() + 8)
    return last.toISOString()
  }

  function getExpiryDate(): string {
    if (expiryMode === 'never') return '2099-12-31T23:59:59Z'
    if (expiryMode === 'custom' && customExpiry) return new Date(customExpiry).toISOString()
    // auto: 8 Tage nach letzter Stunde (nur bei Kurs-Modell sinnvoll)
    if (model === 'course' && courseId) {
      const course = courses.find(c => c.id === courseId)
      if (course) return getAutoExpiry(course)
    }
    // Standard 90 Tage
    const d = new Date(); d.setDate(d.getDate() + 90); return d.toISOString()
  }

  // Wenn Kurs gewählt: Credits automatisch berechnen
  useEffect(() => {
    if (model === 'course' && courseId) {
      const course = courses.find(c => c.id === courseId)
      if (course) setAmount(getRemainingUnits(course))
    }
  }, [courseId, model])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!userId) return
    setLoading(true)
    const expiresAt = getExpiryDate()
    const { error } = await supabase.from('credits').insert({
      user_id: userId,
      course_id: model === 'course' && courseId ? courseId : null,
      model, total: amount, used: 0, expires_at: expiresAt,
    })
    if (!error) {
      await supabase.from('audit_log').insert({
        action: 'credit_assigned',
        details: { target_user_id: userId, amount, model, expires_at: expiresAt }
      })
      setSuccess(true)
    }
    setLoading(false)
  }

  if (success) return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Credits vergeben" isAdmin />
      <div className="px-5 py-10 text-center">
        <div className="w-14 h-14 rounded-full bg-yoga-green-bg flex items-center justify-center mx-auto mb-4">
          <i className="ti ti-check text-2xl text-yoga-green-text" />
        </div>
        <h2 className="text-lg font-bold mb-2">Credits vergeben!</h2>
        <p className="text-sm text-yoga-text/60 mb-6">{targetUser?.first_name} hat {amount} Credits erhalten.</p>
        <button onClick={() => router.back()} className="btn-primary">Zurück</button>
      </div>
    </div>
  )

  const selectedCourse = courses.find(c => c.id === courseId)

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Credits vergeben" isAdmin />
      <div className="px-4 py-4">
        {targetUser && (
          <div className="card mb-4">
            <p className="text-xs text-yoga-text/50 mb-0.5">Credits für</p>
            <p className="text-base font-bold">{targetUser.first_name} {targetUser.last_name}</p>
            <p className="text-sm text-yoga-text/50">{targetUser.email}</p>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="field-label">Credit-Modell</label>
            <div className="space-y-2">
              {[
                { value: 'tenpack', label: 'Punktekarte', desc: 'Flexibel, kursübergreifend' },
                { value: 'course', label: 'Kurs', desc: 'Credits werden automatisch berechnet' },
                { value: 'quarterly', label: 'Quartal-Abo', desc: 'Quartalsweise Credits' },
              ].map(m => (
                <label key={m.value} className={`flex items-start gap-3 card cursor-pointer ${model === m.value ? 'border-yoga-text/40' : ''}`}>
                  <input type="radio" name="model" value={m.value} checked={model === m.value as any}
                    onChange={() => { setModel(m.value as any); setCourseId(''); setExpiryMode('auto') }}
                    className="mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold">{m.label}</div>
                    <div className="text-xs text-yoga-text/50">{m.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {model === 'course' && (
            <div>
              <label className="field-label">Kurs auswählen</label>
              <select className="field-input" value={courseId}
                onChange={e => setCourseId(e.target.value)} required>
                <option value="">Kurs wählen...</option>
                {courses.map(c => {
                  const rem = getRemainingUnits(c)
                  return <option key={c.id} value={c.id}>{c.name} → {rem} Credits</option>
                })}
              </select>
              {selectedCourse && (
                <div className="mt-2 bg-yoga-green-bg rounded-yoga p-3 border border-yoga-green-text/20">
                  <p className="text-xs text-yoga-green-text">
                    <strong>{getRemainingUnits(selectedCourse)} Credits</strong> werden vergeben ·
                    Verfall: <strong>{new Date(getAutoExpiry(selectedCourse)).toLocaleDateString('de-DE')}</strong>
                    {' '}(8 Tage nach letzter Stunde)
                  </p>
                </div>
              )}
            </div>
          )}

          {model !== 'course' && (
            <div>
              <label className="field-label">Anzahl Credits</label>
              <input className="field-input" type="number" min={1} max={50} value={amount}
                onChange={e => setAmount(parseInt(e.target.value))} required />
            </div>
          )}

          {model !== 'course' && (
            <div>
              <label className="field-label">Verfallsdatum</label>
              <div className="space-y-2">
                {[
                  { value: 'auto', label: 'Standard – 90 Tage ab heute' },
                  { value: 'custom', label: 'Individuelles Datum wählen' },
                  { value: 'never', label: 'Kein Ablaufdatum' },
                ].map(opt => (
                  <label key={opt.value} className={`flex items-center gap-3 card cursor-pointer ${expiryMode === opt.value ? 'border-yoga-text/40' : ''}`}>
                    <input type="radio" name="expiry" value={opt.value}
                      checked={expiryMode === opt.value as any}
                      onChange={() => setExpiryMode(opt.value as any)} />
                    <span className="text-sm font-medium">{opt.label}</span>
                  </label>
                ))}
              </div>
              {expiryMode === 'custom' && (
                <div className="mt-2">
                  <input className="field-input" type="date" value={customExpiry}
                    onChange={e => setCustomExpiry(e.target.value)}
                    min={new Date().toISOString().split('T')[0]} required />
                </div>
              )}
            </div>
          )}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Wird vergeben...' : `${amount} Credits vergeben`}
          </button>
          <button type="button" onClick={() => router.back()} className="btn-ghost">Abbrechen</button>
        </form>
      </div>
      <BottomNav isAdmin />
    </div>
  )
}

export default function CreditsVergebenPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-yoga-text/50 text-sm">Wird geladen...</p></div>}>
      <CreditsVergebenInner />
    </Suspense>
  )
}
