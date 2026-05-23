'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/auth'
import { Email } from '@/lib/email'
import { CURRENT_AGB_VERSION, AGB_CHANGELOG } from '@/lib/agb-version'

// Einfaches PDF als Base64 via HTML-Canvas-Trick mit jsPDF-ähnlichem Ansatz
// Wir bauen das PDF manuell als minimales PDF-Binary
async function uploadToEdgeFunction(fullName: string, email: string, acceptedAt: string, accessToken: string): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const datePart = new Date(acceptedAt).toISOString().split('T')[0]
    const safeName = fullName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_')
    const filename = `AGB_${safeName}_${datePart}.pdf`

    const response = await fetch(`${supabaseUrl}/functions/v1/agb-drive-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': supabaseKey!,
        'x-function-secret': process.env.NEXT_PUBLIC_EDGE_SECRET || '',
      },
      body: JSON.stringify({ fullName, email, acceptedAt, filename, userAgent: navigator.userAgent }),
    })
    const result = await response.json()
    console.log('Drive upload result:', result)
  } catch (e) {
    console.error('Drive upload error:', e)
  }
}


export default function RechtlichesPage() {
  const [step, setStep] = useState<1 | 2>(1)
  const [scrolledStep1, setScrolledStep1] = useState(false)
  const [scrolledStep2, setScrolledStep2] = useState(false)
  const [checked1, setChecked1] = useState(false)
  const [checked2, setChecked2] = useState(false)
  const [checked3, setChecked3] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  // Sarah-Wunsch 2026-05-23: Re-Acceptance-Modus wenn AGB-Version aktualisiert wurde.
  // Yogi hat AGB schon mal akzeptiert, aber alte Version → zeige kompakte Re-Bestätigung
  // mit Changelog statt komplettem Onboarding.
  const [isReAcceptance, setIsReAcceptance] = useState(false)
  const [previousVersion, setPreviousVersion] = useState<number>(1)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function check() {
      const user = await getCurrentUser()
      if (!user) { window.location.href = '/login'; return }
      const { data: prof } = await supabase
        .from('profiles').select('legal_accepted_at, is_admin, first_name, agb_version').eq('id', user.id).single()

      // Anonymisiertes Profil (DSGVO-gelöscht) → sofort ausloggen
      if (!prof || prof.first_name === 'Gelöschter') {
        await supabase.auth.signOut({ scope: 'global' })
        localStorage.clear()
        sessionStorage.clear()
        window.location.replace('/login')
        return
      }

      const userVersion = (prof as any).agb_version ?? 0
      const isAgbAktuell = prof?.legal_accepted_at && userVersion >= CURRENT_AGB_VERSION

      if (isAgbAktuell) {
        if (prof.is_admin) router.replace('/admin/dashboard')
        else router.push('/kurse')
        return
      }

      // Re-Acceptance-Pfad: Yogi hat schon mal akzeptiert (legal_accepted_at != null)
      // aber alte Version (agb_version < CURRENT)
      if (prof?.legal_accepted_at && userVersion < CURRENT_AGB_VERSION) {
        setIsReAcceptance(true)
        setPreviousVersion(userVersion)
      }
      setReady(true)
    }
    check()
  }, [])

  function handleScroll1(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 30) setScrolledStep1(true)
  }

  function handleScroll2(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 30) setScrolledStep2(true)
  }

  async function handleAccept() {
    if (!checked1 || !checked2 || !checked3) return
    setLoading(true)
    const user = await getCurrentUser()
    if (!user) { window.location.href = '/login'; return }

    const { data: prof } = await supabase.from('profiles')
      .select('first_name, last_name, email').eq('id', user.id).single()

    // Anonymisiertes Profil darf KEINE AGB akzeptieren
    if (!prof || prof.first_name === 'Gelöschter') {
      await supabase.auth.signOut({ scope: 'global' })
      localStorage.clear()
      window.location.replace('/login')
      return
    }

    const fullName = `${prof?.first_name || ''} ${prof?.last_name || ''}`.trim()
    // Email NUR aus Profil, NICHT aus Auth-User (verhindert gelöschte Accounts)
    const email = prof?.email || ''
    if (!email) {
      // Kein Email = anonymisierter Account
      await supabase.auth.signOut({ scope: 'global' })
      window.location.replace('/login')
      return
    }
    const acceptedAt = new Date().toISOString()

    // 1) In Supabase speichern – inkl. AGB-Versions-Update (Sarah-Wunsch 2026-05-23)
    const { error: profileError } = await supabase.from('profiles').update({
      legal_accepted_at: acceptedAt,
      legal_version: '2025-12',
      agb_version: CURRENT_AGB_VERSION,
    }).eq('id', user.id)
    console.log('Profile update:', profileError ? 'ERROR: ' + profileError.message : 'OK')

    const { error: legalError } = await supabase.from('legal_acceptances').insert({
      user_id: user.id,
      version: String(CURRENT_AGB_VERSION),
      agb_version: String(CURRENT_AGB_VERSION),
      full_name: fullName,
      accepted_at: acceptedAt,
      user_agent: navigator.userAgent,
    })
    console.log('Legal acceptance:', legalError ? 'ERROR: ' + legalError.message : 'OK')

    // 2) PDF via Edge Function generieren und zu Google Drive hochladen
    // WICHTIG: erst hochladen, dann weiterleiten – sonst bricht der Browser den Request ab
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const sb = createClient()
      const { data: { session: sess } } = await sb.auth.getSession()
      const accessToken = sess?.access_token || ''
      await uploadToEdgeFunction(fullName, email, acceptedAt, accessToken)
    } catch (e) {
      console.error('Drive upload error:', e)
      // Fehler beim Upload soll Registrierung nicht blockieren
    }

    // Erst NACH dem Upload weiterleiten
    router.push('/kurse')
  }

  if (!ready) return (
    <div className="min-h-screen flex items-center justify-center">
      <i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" />
    </div>
  )

  return (
    <div className="max-w-md mx-auto min-h-screen bg-yoga-bg flex flex-col">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-yoga-border bg-yoga-bg sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-3">
          <img src="https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png"
            alt="Logo" className="w-10 h-10 object-contain" />
          <div>
            <p className="text-base font-bold">Yoga mit Sarah</p>
            <p className="text-xs text-yoga-text/50">
              {isReAcceptance ? 'AGB wurden aktualisiert' : 'Einmalige Bestätigung erforderlich'}
            </p>
          </div>
        </div>
        {/* Re-Acceptance-Banner: Yogi hat schon V1 akzeptiert, neue Version vorhanden */}
        {isReAcceptance && (
          <div className="bg-yoga-amber-bg/60 border border-yoga-amber-text/30 rounded-yoga p-3 mb-3">
            <p className="text-xs font-semibold text-yoga-amber-text mb-1">
              Neue AGB-Version {CURRENT_AGB_VERSION} — bitte erneut bestätigen
            </p>
            <p className="text-xs text-yoga-text/70 mb-1">Was hat sich seit Version {previousVersion} geändert:</p>
            <ul className="text-xs text-yoga-text/70 list-disc list-inside space-y-0.5">
              {Array.from({ length: CURRENT_AGB_VERSION - previousVersion }).flatMap((_, i) => {
                const v = previousVersion + 1 + i
                const entry = AGB_CHANGELOG[v]
                if (!entry) return [<li key={v}>Version {v}</li>]
                return entry.changes.map((c, idx) => <li key={`${v}-${idx}`}><strong>v{v}:</strong> {c}</li>)
              })}
            </ul>
          </div>
        )}
        <div className="flex gap-2">
          <div className={`h-2 flex-1 rounded-full transition-colors ${step >= 1 ? 'bg-yoga-text' : 'bg-yoga-border2'}`} />
          <div className={`h-2 flex-1 rounded-full transition-colors ${step >= 2 ? 'bg-yoga-text' : 'bg-yoga-border2'}`} />
        </div>
        <p className="text-xs text-yoga-text/40 mt-1">Schritt {step} von 2</p>
      </div>

      {step === 1 && (
        <div className="flex flex-col flex-1 px-5 pt-4 pb-6">
          <h2 className="text-lg font-bold mb-1">Haftungserklärung</h2>
          <p className="text-sm text-yoga-text/55 mb-3">Bitte lies den Text vollständig durch.</p>
          <div onScroll={handleScroll1}
            className="overflow-y-auto bg-yoga-card border border-yoga-border2 rounded-yoga p-4 mb-4"
            style={{ maxHeight: '280px' }}>
            <h3 className="text-sm font-bold mb-2">Gesundheit & Eigenverantwortung</h3>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-3">
              Ich erkläre hiermit, dass ich körperlich und geistig in der Lage bin, an Yoga- und Bewegungsangeboten teilzunehmen. Ich nehme auf eigene Verantwortung teil.
            </p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-3">
              Ich verpflichte mich, Sarah Lerch vor Beginn sowie während der Kursdauer über bestehende oder neu auftretende gesundheitliche Einschränkungen, Verletzungen, Schwangerschaft oder Beschwerden zu informieren.
            </p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-3">
              Mir ist bekannt, dass die Yogalehrerin keine Ärztin oder Therapeutin ist und Yoga keine medizinische Behandlung ersetzt.
            </p>
            <h3 className="text-sm font-bold mb-2">Haftung</h3>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-4">
              Die Teilnahme erfolgt auf eigene Verantwortung. Für mitgebrachte Wertgegenstände wird keine Haftung übernommen.
            </p>
            <p className="text-xs text-yoga-text/40 text-center">
              Yoga mit Sarah · Sarah Lerch · Fuldaer Str. 7 · 63628 Bad Soden-Salmünster
            </p>
          </div>
          {!scrolledStep1 && (
            <p className="text-xs text-yoga-text/40 text-center mb-2">
              <i className="ti ti-arrow-down mr-1" />Bitte bis zum Ende scrollen
            </p>
          )}
          <div className={`rounded-yoga p-4 border mb-4 transition-opacity ${scrolledStep1 ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}
            style={{ background: 'var(--yoga-card)', borderColor: 'var(--yoga-border2)' }}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={checked1}
                onChange={e => setChecked1(e.target.checked)}
                className="mt-0.5 flex-shrink-0 w-5 h-5" />
              <span className="text-sm text-yoga-text/80 leading-relaxed">
                Ich habe die Haftungserklärung vollständig gelesen und bestätige sie digital. Ich nehme auf <strong>eigene Verantwortung</strong> teil.
              </span>
            </label>
          </div>
          <button onClick={() => setStep(2)} disabled={!checked1}
            className={`btn-primary ${!checked1 ? 'opacity-40 cursor-not-allowed' : ''}`}>
            Weiter zu AGB & Datenschutz →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col flex-1 px-5 pt-4 pb-6">
          <h2 className="text-lg font-bold mb-1">AGB & Datenschutz</h2>
          <p className="text-sm text-yoga-text/55 mb-3">Bitte lesen und bestätigen.</p>
          <div onScroll={handleScroll2}
            className="overflow-y-auto bg-yoga-card border border-yoga-border2 rounded-yoga p-4 mb-4"
            style={{ maxHeight: '200px' }}>
            <h3 className="text-sm font-bold mb-2">Nachholregeln für Einzelstunden</h3>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-2">• Abmeldung bis 3 Stunden vor Kursbeginn: Credit wird zurückgebucht.</p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-2">• Abmeldung weniger als 3 Stunden vorher: kein Credit zurück.</p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-2">• Warteliste: Nach automatischem Nachrücken 1 Stunde Zeit zur kostenlosen Abmeldung.</p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-2">• Nachholen: Stunden können bis <strong>8 Tage nach Kursende</strong> nachgeholt werden – Credits sind bis dahin gültig und können für andere Stunden genutzt werden.</p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-2">• Vorholen: Stunden dürfen <strong>maximal 10 Tage im Voraus</strong> vorgezogen werden.</p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-4">• Ein Anspruch auf einen freien Platz in einer bestimmten Stunde oder zu einem bestimmten Zeitpunkt besteht nicht. Das Nachholen erfolgt ausschließlich im Rahmen freier Kapazitäten.</p>
            <h3 className="text-sm font-bold mb-2">Rücktritt vom Kurs</h3>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-2">• Bis 7 Tage vor Kursbeginn: kostenfreier Rücktritt möglich.</p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-2">• Ab dem 7. Tag vor Kursbeginn: Stornogebühr <strong>30 €</strong>.</p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-4">• Ab dem 1. Kurstag: Volle Kursgebühr fällig, auch bei Nichterscheinen.</p>
            <a href="https://www.yogamitsarah.me/agb" target="_blank" rel="noopener noreferrer"
              className="text-sm font-bold underline text-yoga-text">
              Vollständige AGB lesen →
            </a>
          </div>
          {!scrolledStep2 && (
            <p className="text-xs text-yoga-text/40 text-center mb-2">
              <i className="ti ti-arrow-down mr-1" />Bitte bis zum Ende scrollen
            </p>
          )}
          <div className={`space-y-3 transition-opacity ${scrolledStep2 ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
            <div className="rounded-yoga p-4 border" style={{ background: 'var(--yoga-card)', borderColor: 'var(--yoga-border2)' }}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={checked2}
                  onChange={e => setChecked2(e.target.checked)}
                  className="mt-0.5 flex-shrink-0 w-5 h-5" />
                <span className="text-sm text-yoga-text/80 leading-relaxed">
                  Ich habe die <a href="https://www.yogamitsarah.me/agb" target="_blank" rel="noopener noreferrer" className="underline font-semibold">AGB</a> gelesen und akzeptiere sie.
                </span>
              </label>
            </div>
            <div className="rounded-yoga p-4 border" style={{ background: 'var(--yoga-card)', borderColor: 'var(--yoga-border2)' }}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={checked3}
                  onChange={e => setChecked3(e.target.checked)}
                  className="mt-0.5 flex-shrink-0 w-5 h-5" />
                <span className="text-sm text-yoga-text/80 leading-relaxed">
                  Ich stimme der Verarbeitung meiner Daten gemäß der <a href="https://yogamitsarah.me/privacy-policy/" target="_blank" rel="noopener noreferrer" className="underline font-semibold">Datenschutzerklärung</a> zu.
                </span>
              </label>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => setStep(1)} className="btn-ghost w-auto px-5">← Zurück</button>
            <button onClick={handleAccept}
              disabled={!checked2 || !checked3 || loading}
              className={`btn-primary flex-1 ${(!checked2 || !checked3) ? 'opacity-40 cursor-not-allowed' : ''}`}>
              {loading ? 'Wird gespeichert...' : 'Bestätigen & loslegen '}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
