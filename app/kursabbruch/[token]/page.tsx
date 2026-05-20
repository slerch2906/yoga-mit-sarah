'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function KursabbruchPage() {
  const { token } = useParams<{ token: string }>()
  const supabase = createClient()
  const [entry, setEntry] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [choosing, setChoosing] = useState(false)
  const [done, setDone] = useState<'guthaben'|'erstattung'|null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('course_cancellation_responses')
        .select('*, course:courses(name)')
        .eq('token', token)
        .maybeSingle()
      setEntry(data)
      setLoading(false)
      if (data?.choice) setDone(data.choice as 'guthaben' | 'erstattung')
    }
    load()
  }, [token])

  async function handleChoice(choice: 'guthaben' | 'erstattung') {
    if (entry?.choice) return // bereits gewählt
    setChoosing(true)

    const res = await fetch(`/api/kursabbruch/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice }),
    })
    const json = await res.json().catch(() => ({}))

    if (!res.ok) {
      setError('Fehler beim Speichern. Bitte versuche es erneut.')
      setChoosing(false)
      return
    }

    // alreadyChosen: jemand hat in der Zwischenzeit geklickt
    setDone((json.alreadyChosen ?? choice) as 'guthaben' | 'erstattung')
    setChoosing(false)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" />
    </div>
  )

  if (!entry) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center">
        <div className="text-4xl mb-4"></div>
        <p className="font-semibold">Link ungültig oder abgelaufen.</p>
      </div>
    </div>
  )

  const expired = new Date(entry.expires_at) < new Date()

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-yoga-bg">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <img src="https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png"
            alt="Yoga mit Sarah" className="w-16 h-16 object-contain mx-auto mb-3 rounded-full" />
          <h1 className="text-xl font-bold">Yoga mit Sarah</h1>
        </div>

        {done ? (
          <div className="card text-center">
            <div className="text-4xl mb-3">{done === 'guthaben' ? '' : ''}</div>
            <p className="font-semibold text-base mb-2">
              {done === 'guthaben' ? 'Guthaben gespeichert!' : 'Erstattung beantragt!'}
            </p>
            <p className="text-sm text-yoga-text/60">
              {done === 'guthaben'
                ? `Deine ${entry.remaining_sessions} Credits sind 2 Jahre gültig und werden beim nächsten Kurs angerechnet. Das Guthaben ist nur für neue Kurse verwendbar, nicht für Einzelstunden.`
                : 'Sarah meldet sich bei dir wegen der Erstattung.'}
            </p>
          </div>
        ) : expired ? (
          <div className="card text-center">
            <div className="text-4xl mb-3"></div>
            <p className="font-semibold">Frist abgelaufen</p>
            <p className="text-sm text-yoga-text/60 mt-2">
              Die 7-Tage-Frist ist abgelaufen. Dein Guthaben wurde automatisch gutgeschrieben.
            </p>
          </div>
        ) : (
          <div className="card">
            <p className="text-sm text-yoga-text/60 mb-1">Kurs abgesagt:</p>
            <p className="font-bold text-base mb-4">{entry.course?.name}</p>
            <p className="text-sm text-yoga-text/70 mb-5">
              Es wurden <strong>{entry.remaining_sessions} Stunden</strong> abgesagt.
              Was möchtest du?
            </p>

            <div className="space-y-3">
              <button onClick={() => handleChoice('guthaben')} disabled={choosing}
                className="w-full p-4 rounded-yoga border-2 border-yoga-border2 text-left hover:border-yoga-text transition-colors cursor-pointer bg-transparent">
                <div className="text-base font-bold mb-0.5"> Guthaben behalten</div>
                <div className="text-xs text-yoga-text/60">
                  {entry.remaining_sessions} Credits, 2 Jahre gültig. Wird beim nächsten Kurs angerechnet.
                </div>
                <div className="text-xs text-yoga-text/40 mt-1">
                  Nur für ganze Kurse verwendbar, nicht für Einzelstunden.
                </div>
              </button>
              <button onClick={() => handleChoice('erstattung')} disabled={choosing}
                className="w-full p-4 rounded-yoga border-2 border-yoga-border2 text-left hover:border-yoga-text transition-colors cursor-pointer bg-transparent">
                <div className="text-base font-bold mb-0.5"> Geld zurück</div>
                <div className="text-xs text-yoga-text/60">
                  Sarah meldet sich bei dir wegen der anteiligen Erstattung.
                </div>
              </button>
            </div>

            {error && <p className="text-sm text-red-500 text-center mt-2">{error}</p>}
            <p className="text-xs text-yoga-text/40 text-center mt-4">
              Frist: {new Date(entry.expires_at).toLocaleDateString('de-DE')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
