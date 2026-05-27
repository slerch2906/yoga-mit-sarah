'use client'

/**
 * Onboarding-Tour für neue Yogis nach AGB-Akzeptanz (Sarah-Wunsch 2026-05-23).
 * 4 Slides, klar erklärend, weg-klickbar. Speichert profile.onboarding_completed=true.
 *
 * Logik:
 *  - Component wird in /kurse gerendert
 *  - Wenn profile.onboarding_completed === false: Overlay erscheint
 *  - Yogi klickt durch (Weiter / Zurück / Überspringen / Fertig)
 *  - "Fertig" oder "Überspringen" → UPDATE profile + Overlay verschwindet
 */

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Welle 6 (Sarah 2026-05-27): Tab "Kurse" wurde in Welle 5 zu "Kalender"
// umbenannt. Tour-Texte entsprechend aktualisiert. Schritt 4 enthält
// jetzt zusätzlich den Hinweis auf den „Warteliste"-Tab als zentrale
// Übersicht.
const slides = [
  {
    icon: 'ti-calendar-week',
    title: 'Wochenübersicht',
    tabHint: 'Tab „Kalender" — unten links',
    body: 'Hier siehst Du alle Stunden und Events in einer Wochenübersicht. Mit den Pfeilen oder dem Datum oben wechselst du die Woche. Stunden in denen du angemeldet bist haben einen grünen Rahmen.',
  },
  {
    icon: 'ti-heart',
    title: 'Deine Buchungen — und wie Credits entstehen',
    tabHint: 'Tab „Meine" — dritter Tab unten',
    body: 'Unter „Meine" findest du alle deine Kurse auf die Sarah dich eingetragen hat und deine Einzelstunden die du gebucht hast. Wenn du eine rechtzeitig (bis 3h vorher) absagst, bekommst du einen Credit zum Nachholen — den kannst du dann für eine andere Stunde nutzen.',
  },
  {
    icon: 'ti-circle-plus',
    title: 'Stunde buchen',
    tabHint: 'In „Kalender" auf eine freie Stunde tippen',
    body: 'Klick einfach auf eine freie Stunde und wähle „Buchen". Ein Credit wird automatisch verrechnet — du musst nichts weiter tun.',
  },
  {
    icon: 'ti-list',
    title: 'Volle Stunde? Kein Problem',
    tabHint: 'Tab „Warteliste" — zweiter Tab unten',
    body: 'Du kannst dich bei vollen Stunden auf die Warteliste setzen lassen, dann rückst Du automatisch nach und wirst per E-Mail benachrichtigt. Oder du lässt dich einfach nur benachrichtigen, wenn ein Platz frei wird. Wo du eingetragen bist, siehst du im Tab „Warteliste".',
  },
  {
    icon: 'ti-device-mobile',
    title: 'App auf den Startbildschirm',
    tabHint: 'Profil → „Anleitung anzeigen"',
    body: 'Damit du die App wie eine echte App auf dem Handy hast: Wenn unten ein kleines „Installieren"-Fenster aufpoppt, einfach drauftippen. Falls nicht: geh in dein Profil und klick auf „Anleitung anzeigen" — da steht für iPhone und Android wie es geht.',
  },
]

interface Props {
  /** Wird auf true gesetzt sobald Tour zu Ende oder geskippt */
  onComplete: () => void
}

export default function OnboardingTour({ onComplete }: Props) {
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const isLast = step === slides.length - 1

  async function finish() {
    setSaving(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('profiles')
          .update({ onboarding_completed: true })
          .eq('id', user.id)
      }
    } catch {}
    // Sarah-Wunsch 2026-05-25: PWA-Install-Banner darf erst NACH der Tour erscheinen.
    // Flag wird vom Inline-Script in app/layout.tsx geprüft (onboardingDone()).
    try { localStorage.setItem('onboarding_completed', '1') } catch {}
    setSaving(false)
    onComplete()
  }

  const slide = slides[step]

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4 modal-backdrop">
      <div className="bg-yoga-bg w-full max-w-sm rounded-2xl shadow-xl overflow-hidden modal-card">
        {/* Header mit Step-Indikator */}
        <div className="bg-yoga-card px-5 pt-5 pb-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-yoga-text/50 font-semibold">
              Schritt {step + 1} von {slides.length}
            </span>
            <button onClick={finish} disabled={saving}
              className="text-xs text-yoga-text/50 hover:opacity-70">
              Überspringen
            </button>
          </div>
          {/* Progress-Punkte */}
          <div className="flex gap-1.5">
            {slides.map((_, i) => (
              <div key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= step ? 'bg-yoga-text' : 'bg-yoga-border2'
                }`} />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-6 text-center">
          <div className="mx-auto mb-3 w-16 h-16 rounded-full bg-yoga-amber-bg flex items-center justify-center">
            <i className={`ti ${slide.icon} text-3xl text-yoga-text`} />
          </div>
          <h2 className="text-lg font-bold mb-1">{slide.title}</h2>
          {/* Sarah-Wunsch 2026-05-24: eindeutiger Hinweis welcher Tab/Aktion gemeint ist */}
          {slide.tabHint && (
            <div className="inline-flex items-center gap-1 text-xs font-semibold text-yoga-amber-text bg-yoga-amber-bg rounded-full px-2.5 py-0.5 mb-3">
              <i className="ti ti-arrow-down text-xs" />
              {slide.tabHint}
            </div>
          )}
          <p className="text-sm text-yoga-text/75 leading-relaxed">
            {slide.body}
          </p>
        </div>

        {/* Buttons — Sarah-Wunsch 2026-05-25: ab Schritt 2 sollen Zurueck/Weiter
            (und auf der letzten Seite Zurueck/Los-geht's) gleich breit sein. */}
        <div className="px-5 pb-5 flex gap-2">
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} disabled={saving}
              className="flex-1 btn-secondary text-sm py-2.5">
              Zurück
            </button>
          )}
          {!isLast ? (
            <button onClick={() => setStep(s => s + 1)}
              className="flex-1 btn-primary text-sm py-2.5">
              Weiter
            </button>
          ) : (
            <button onClick={finish} disabled={saving}
              className="flex-1 btn-primary text-sm py-2.5 bg-yoga-green-text">
              {saving ? '…' : 'Los geht\'s!'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
