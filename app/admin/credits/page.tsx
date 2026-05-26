'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

// Sarah-Wunsch 2026-05-25: Quick-Credit-Form ueberarbeitet.
//  - "Kurs" als Modell raus (macht Sarah ueber "In Kurs einbuchen")
//  - Nur noch 2 Modelle: Punktekarte + Quartal-Abo
//  - Guthaben raus (entsteht nur via Kursabbruch, nicht manuell)
//  - Punktekarte: Default 90 Tage, plus "individuell" + "kein Ablaufdatum"
//  - Quartal-Abo: aktuelles ODER naechstes Quartal waehlbar; Ablauf = letzter
//    Tag des gewaehlten Quartals; wenn naechstes Quartal: valid_from = erster
//    Tag des Quartals → Credits sind erst ab dann nutzbar (Anzeige aber sofort).

type Model = 'tenpack' | 'quarterly'

function quarterDates(date: Date) {
  // Berlin-lokales Jahr/Monat
  const year = date.getFullYear()
  const quarter = Math.floor(date.getMonth() / 3) // 0..3 = Q1..Q4
  const startMonth = quarter * 3 // 0,3,6,9
  const endMonth = startMonth + 2
  const startDate = new Date(year, startMonth, 1)
  // Letzter Tag des End-Monats: Tag 0 vom nächsten Monat
  const endDate = new Date(year, endMonth + 1, 0)
  return {
    label: `Q${quarter + 1} ${year}`,
    startDate, endDate,
    startIso: toIsoDate(startDate),
    endIso: toIsoDateTime(endDate, true),
  }
}
function toIsoDate(d: Date): string {
  return d.toLocaleDateString('en-CA') // YYYY-MM-DD lokal Berlin
}
function toIsoDateTime(d: Date, endOfDay = false): string {
  const dd = new Date(d)
  if (endOfDay) dd.setHours(23, 59, 59, 999)
  return dd.toISOString()
}

function CreditsVergebenInner() {
  const searchParams = useSearchParams()
  const userId = searchParams.get('user')
  const [targetUser, setTargetUser] = useState<any>(null)
  const [model, setModel] = useState<Model>('tenpack')
  const [amount, setAmount] = useState(10)
  // Punktekarte
  const [tenpackExpiryMode, setTenpackExpiryMode] = useState<'90days' | 'custom' | 'never'>('90days')
  const [customExpiry, setCustomExpiry] = useState('')
  // Quartal-Abo
  const [quarterChoice, setQuarterChoice] = useState<'current' | 'next'>('current')

  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    if (!userId) return
    supabase.from('profiles').select('*').eq('id', userId).single()
      .then(({ data }) => setTargetUser(data))
  }, [userId])

  // Quartal-Vorschau
  const today = new Date()
  const currentQ = quarterDates(today)
  // Naechstes Quartal: 1. Tag nach Ende des aktuellen Quartals
  const nextQStart = new Date(currentQ.endDate); nextQStart.setDate(nextQStart.getDate() + 1)
  const nextQ = quarterDates(nextQStart)

  function computeInsertPayload(): {
    expires_at: string
    valid_from: string | null
  } {
    if (model === 'quarterly') {
      const q = quarterChoice === 'current' ? currentQ : nextQ
      return {
        expires_at: q.endIso,
        // Aktuelles Quartal: sofort nutzbar (valid_from null).
        // Naechstes Quartal: erst ab Quartalsstart nutzbar.
        valid_from: quarterChoice === 'next' ? q.startIso : null,
      }
    }
    // Punktekarte
    if (tenpackExpiryMode === 'never') {
      return { expires_at: '2099-12-31T23:59:59Z', valid_from: null }
    }
    if (tenpackExpiryMode === 'custom' && customExpiry) {
      return { expires_at: new Date(customExpiry + 'T23:59:59').toISOString(), valid_from: null }
    }
    // 90 Tage
    const d = new Date(); d.setDate(d.getDate() + 90); d.setHours(23, 59, 59, 999)
    return { expires_at: d.toISOString(), valid_from: null }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!userId) return
    setLoading(true)
    const { expires_at, valid_from } = computeInsertPayload()
    const { error } = await supabase.from('credits').insert({
      user_id: userId,
      course_id: null,
      model,
      total: amount, used: 0,
      expires_at,
      valid_from,
    })
    if (!error) {
      await supabase.from('audit_log').insert({
        action: 'credit_assigned',
        details: { target_user_id: userId, amount, model, expires_at, valid_from }
      })
      setSuccess(true)
    } else {
      alert('Fehler beim Anlegen: ' + error.message)
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

  const previewQ = quarterChoice === 'current' ? currentQ : nextQ

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Credits vergeben" isAdmin />
      <div className="px-4 py-4">
        {targetUser && (
          /* Sarah-Wunsch: Yogi-Karte klickbar → Yogi-Profil */
          <button
            onClick={() => userId && router.push(`/admin/yogis/${userId}`)}
            className="card mb-4 w-full text-left bg-yoga-card border border-yoga-border cursor-pointer hover:opacity-80 transition-opacity">
            <p className="text-xs text-yoga-text/50 mb-0.5">Credits für</p>
            <p className="text-base font-bold">{targetUser.first_name} {targetUser.last_name}</p>
            <p className="text-sm text-yoga-text/50">{targetUser.email}</p>
          </button>
        )}
        <p className="text-xs text-yoga-text/55 mb-3 leading-snug">
          Tipp: Wenn du einen Yogi <strong>in einen Kurs einbuchen</strong> willst, nutze stattdessen
          den Button „In Kurs einbuchen" auf dem Yogi-Profil. Diese Seite ist für freie Credits
          (Punktekarte oder Quartal-Abo).
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="field-label">Credit-Modell</label>
            <div className="space-y-2">
              {[
                { value: 'tenpack' as Model, label: 'Punktekarte', desc: 'Flexibel, kursübergreifend' },
                { value: 'quarterly' as Model, label: 'Quartal-Abo', desc: 'Gültig im gewählten Quartal' },
              ].map(m => (
                <label key={m.value} className={`flex items-start gap-3 card cursor-pointer ${model === m.value ? 'border-yoga-text/40' : ''}`}>
                  <input type="radio" name="model" value={m.value} checked={model === m.value}
                    onChange={() => setModel(m.value)}
                    className="mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold">{m.label}</div>
                    <div className="text-xs text-yoga-text/50">{m.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="field-label">Anzahl Credits</label>
            <input className="field-input" type="number" min={1} max={50} value={amount}
              onChange={e => setAmount(parseInt(e.target.value))} required />
          </div>

          {model === 'tenpack' && (
            <div>
              <label className="field-label">Verfallsdatum</label>
              <div className="space-y-2">
                {[
                  { value: '90days', label: '90 Tage ab heute (Standard)' },
                  { value: 'custom', label: 'Individuelles Datum wählen' },
                  { value: 'never', label: 'Kein Ablaufdatum' },
                ].map(opt => (
                  <label key={opt.value} className={`flex items-center gap-3 card cursor-pointer ${tenpackExpiryMode === opt.value ? 'border-yoga-text/40' : ''}`}>
                    <input type="radio" name="expiry" value={opt.value}
                      checked={tenpackExpiryMode === opt.value as any}
                      onChange={() => setTenpackExpiryMode(opt.value as any)} />
                    <span className="text-sm font-medium">{opt.label}</span>
                  </label>
                ))}
              </div>
              {tenpackExpiryMode === 'custom' && (
                <div className="mt-2">
                  <input className="field-input" type="date" value={customExpiry}
                    onChange={e => setCustomExpiry(e.target.value)}
                    min={new Date().toISOString().split('T')[0]} required />
                </div>
              )}
            </div>
          )}

          {model === 'quarterly' && (
            <div>
              <label className="field-label">Quartal</label>
              <div className="space-y-2">
                <label className={`flex items-start gap-3 card cursor-pointer ${quarterChoice === 'current' ? 'border-yoga-text/40' : ''}`}>
                  <input type="radio" name="quarter" value="current"
                    checked={quarterChoice === 'current'}
                    onChange={() => setQuarterChoice('current')}
                    className="mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold">Aktuelles Quartal ({currentQ.label})</div>
                    <div className="text-xs text-yoga-text/50">
                      Sofort nutzbar · gültig bis {currentQ.endDate.toLocaleDateString('de-DE')}
                    </div>
                  </div>
                </label>
                <label className={`flex items-start gap-3 card cursor-pointer ${quarterChoice === 'next' ? 'border-yoga-text/40' : ''}`}>
                  <input type="radio" name="quarter" value="next"
                    checked={quarterChoice === 'next'}
                    onChange={() => setQuarterChoice('next')}
                    className="mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold">Nächstes Quartal ({nextQ.label})</div>
                    <div className="text-xs text-yoga-text/50">
                      Nutzbar ab {nextQ.startDate.toLocaleDateString('de-DE')} · gültig bis {nextQ.endDate.toLocaleDateString('de-DE')}
                    </div>
                  </div>
                </label>
              </div>
              {quarterChoice === 'next' && (
                <div className="mt-2 bg-yoga-amber-bg/60 border border-yoga-amber-text/30 rounded-yoga p-3">
                  <p className="text-xs text-yoga-amber-text leading-snug">
                    Der Yogi sieht die Credits in seiner Übersicht, kann sie aber erst ab {nextQ.startDate.toLocaleDateString('de-DE')} einsetzen.
                  </p>
                </div>
              )}
              <div className="mt-2 bg-yoga-green-bg/60 border border-yoga-green-text/20 rounded-yoga p-3">
                <p className="text-xs text-yoga-green-text leading-snug">
                  <strong>{amount} Credits</strong> für <strong>{previewQ.label}</strong> · Verfall: <strong>{previewQ.endDate.toLocaleDateString('de-DE')}</strong>
                </p>
              </div>
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
