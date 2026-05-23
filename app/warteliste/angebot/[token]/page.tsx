'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

/**
 * Magic-Link-Annahme-Seite für 90-Min-Cutoff-Waitlist-Offer.
 * Sarah-Wunsch 2026-05-23: ALLE Waitlist-Yogis bekommen denselben Mail-Typ
 * mit eigenem Token. Wer zuerst klickt, gewinnt.
 */
export default function WaitlistOfferPage() {
  const { token } = useParams<{ token: string }>()
  const [status, setStatus] = useState<'loading' | 'success' | 'too_late' | 'expired' | 'no_credit' | 'error'>('loading')
  const [info, setInfo] = useState<any>(null)

  useEffect(() => {
    if (!token) return
    const accept = async () => {
      try {
        const res = await fetch(`/api/waitlist-offer/${token}`, { method: 'POST' })
        const json = await res.json().catch(() => ({}))
        if (res.ok) { setStatus('success'); setInfo(json); return }
        if (json?.error === 'too_late') { setStatus('too_late'); return }
        if (json?.error === 'expired') { setStatus('expired'); return }
        if (json?.error === 'no_credit') { setStatus('no_credit'); return }
        setStatus('error')
      } catch (e) {
        setStatus('error')
      }
    }
    accept()
  }, [token])

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-yoga-bg">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <img src="https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png"
            alt="Logo" className="w-16 h-16 object-contain mx-auto mb-3 rounded-full" />
          <h1 className="text-xl font-bold">Yoga mit Sarah</h1>
        </div>

        {status === 'loading' && (
          <div className="card text-center">
            <i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40 mb-2" />
            <p className="text-sm">Dein Platz wird geprüft...</p>
          </div>
        )}

        {status === 'success' && (
          <div className="card text-center">
            <div className="text-4xl mb-3">🎉</div>
            <p className="font-semibold text-base mb-2">Du bist dabei!</p>
            <p className="text-sm text-yoga-text/60 mb-1">
              Stunde: <strong>{info?.courseName}</strong>
            </p>
            {info?.date && (
              <p className="text-sm text-yoga-text/60">
                {new Date(`${info.date}T${info.timeStart || '00:00'}`).toLocaleString('de-DE', {
                  weekday: 'long', day: 'numeric', month: 'long',
                  hour: '2-digit', minute: '2-digit',
                  timeZone: 'Europe/Berlin'
                })} Uhr
              </p>
            )}
            <a href="/meine" className="btn-primary mt-4 inline-block">Zu meinen Buchungen</a>
          </div>
        )}

        {status === 'too_late' && (
          <div className="card text-center">
            <div className="text-3xl mb-3">😔</div>
            <p className="font-semibold mb-2">Leider zu spät</p>
            <p className="text-sm text-yoga-text/60">
              Jemand anderes war schneller — der Platz wurde bereits vergeben.
            </p>
          </div>
        )}

        {status === 'expired' && (
          <div className="card text-center">
            <div className="text-3xl mb-3">⏰</div>
            <p className="font-semibold mb-2">Stunde hat schon begonnen</p>
            <p className="text-sm text-yoga-text/60">
              Das Angebot ist abgelaufen — die Stunde läuft bereits oder ist vorbei.
            </p>
          </div>
        )}

        {status === 'no_credit' && (
          <div className="card text-center">
            <div className="text-3xl mb-3">💳</div>
            <p className="font-semibold mb-2">Kein freier Credit</p>
            <p className="text-sm text-yoga-text/60">
              Du hast aktuell keinen freien Credit. Der Platz wird dem nächsten Yogi auf der Warteliste angeboten.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="card text-center">
            <div className="text-3xl mb-3">❌</div>
            <p className="font-semibold mb-2">Fehler</p>
            <p className="text-sm text-yoga-text/60">
              Etwas ist schiefgegangen. Bitte versuche es nochmal oder schau in deine Wartelisten-Übersicht.
            </p>
            <a href="/meine" className="btn-secondary mt-4 inline-block">Meine Stunden</a>
          </div>
        )}
      </div>
    </div>
  )
}
