'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/auth'
import { Email } from '@/lib/email'
import { getCurrentAgbVersion, getAgbChangelogSince, type AgbVersion } from '@/lib/agb-version'

// Einfaches PDF als Base64 via HTML-Canvas-Trick mit jsPDF-ähnlichem Ansatz
// Wir bauen das PDF manuell als minimales PDF-Binary
// Welle S1/H8 (Sarah 2026-05-27): Direkter Edge-Call ersetzt durch Server-Proxy
// /api/agb-drive-upload — damit verlaesst NEXT_PUBLIC_EDGE_SECRET das Bundle.
// Die API-Route prueft den Bearer-Token serverseitig.
async function uploadToEdgeFunction(fullName: string, email: string, acceptedAt: string, accessToken: string): Promise<void> {
  try {
    const datePart = new Date(acceptedAt).toISOString().split('T')[0]
    const safeName = fullName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_')
    const filename = `AGB_${safeName}_${datePart}.pdf`

    const response = await fetch('/api/agb-drive-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ fullName, email, acceptedAt, filename, userAgent: navigator.userAgent }),
    })
    const result = await response.json().catch(() => ({}))
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
  const [currentAgb, setCurrentAgb] = useState<AgbVersion | null>(null)
  const [changelogSince, setChangelogSince] = useState<AgbVersion[]>([])
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function check() {
      const user = await getCurrentUser()
      if (!user) { window.location.href = '/login'; return }
      const [{ data: prof }, agb] = await Promise.all([
        supabase.from('profiles').select('legal_accepted_at, is_admin, first_name, agb_version').eq('id', user.id).single(),
        getCurrentAgbVersion(supabase),
      ])

      if (!prof || prof.first_name === 'Gelöschter') {
        await supabase.auth.signOut({ scope: 'global' })
        localStorage.clear(); sessionStorage.clear()
        window.location.replace('/login')
        return
      }

      const userVersion = (prof as any).agb_version ?? 0
      const currentOrder = agb?.sort_order ?? 1
      const isAgbAktuell = prof?.legal_accepted_at && userVersion >= currentOrder

      if (isAgbAktuell) {
        if (prof.is_admin) router.replace('/admin/dashboard')
        else router.push('/kurse')
        return
      }

      setCurrentAgb(agb)
      // Re-Acceptance-Pfad: Yogi hat schon akzeptiert, aber alte Version
      if (prof?.legal_accepted_at && userVersion < currentOrder) {
        setIsReAcceptance(true)
        const log = await getAgbChangelogSince(supabase, userVersion)
        setChangelogSince(log)
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

    // 1) Profile-Update mit aktueller AGB-Version (Sarah-Wunsch 2026-05-23)
    const targetOrder = currentAgb?.sort_order ?? 1
    const targetLabel = currentAgb?.label ?? 'Dezember 2025'
    const { error: profileError } = await supabase.from('profiles').update({
      legal_accepted_at: acceptedAt,
      legal_version: targetLabel,
      agb_version: targetOrder,
    }).eq('id', user.id)
    console.log('Profile update:', profileError ? 'ERROR: ' + profileError.message : 'OK')

    const { error: legalError } = await supabase.from('legal_acceptances').insert({
      user_id: user.id,
      version: targetLabel,
      agb_version: targetLabel,
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
        {/* Re-Acceptance-Banner: Yogi hat schon alte Version akzeptiert, neue da */}
        {isReAcceptance && currentAgb && (
          <div className="bg-yoga-amber-bg/60 border border-yoga-amber-text/30 rounded-yoga p-3 mb-3">
            <p className="text-xs font-semibold text-yoga-amber-text mb-1">
              Hallo! Es gibt eine aktualisierte AGB-Version „{currentAgb.label}". Bitte lies dir die Änderungen kurz durch und bestätige sie, damit du weiter buchen kannst.
            </p>
            <p className="text-xs text-yoga-text/70 mb-1">Was hat sich geändert:</p>
            <ul className="text-xs text-yoga-text/70 list-disc list-inside space-y-1">
              {changelogSince.map(v => (
                <li key={v.id}>
                  <strong>{v.label}:</strong> {v.changelog.split('\n').filter(l => l.trim()).join(' · ')}
                </li>
              ))}
            </ul>
            <p className="text-xs text-yoga-text/55 mt-2">
              Vollständige AGB: <a href="https://www.yogamitsarah.me/agb" target="_blank" rel="noopener noreferrer" className="underline">yogamitsarah.me/agb</a>
            </p>
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
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-2">• Bis <strong>14 Tage</strong> vor Kursbeginn: kostenfreier Rücktritt möglich.</p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-2">• <strong>13–7 Tage</strong> vor Kursbeginn: Bearbeitungsgebühr <strong>30 €</strong>.</p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-2">• <strong>Ab 6 Tagen</strong> vor Kursbeginn: Die volle Kursgebühr fällig, auch bei Nichterscheinen.</p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-4">• <strong>Option:</strong> Du kannst einen Ersatzteilnehmer benennen — auch innerhalb der Stornofrist.</p>
            <h3 className="text-sm font-bold mb-2">Veranstaltungen / Events</h3>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-2">• Kostenfreier Rücktritt bis <strong>7 Tage</strong> vor Veranstaltungsbeginn.</p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-2">• Danach fällt die volle Gebühr an — außer du benennst einen Ersatzteilnehmer.</p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-4">• Warteliste: Rückst du automatisch nach, hast du noch <strong>60 Minuten</strong> Zeit, dich kostenlos wieder abzumelden. Danach gilt die 7-Tage-Stornofrist.</p>
            <h3 className="text-sm font-bold mb-2">Allgemeine Regeln</h3>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-2">• Bitte sei pünktlich auf der Matte. Bei Verspätung — kein Eintritt während der Anfangsentspannung.</p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-2">• Schalte dein Handy immer stumm oder aus.</p>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-4">• Aus Rücksicht auf die Gruppe bitte bei ansteckenden Erkrankungen / Erkältungssymptomen nicht am Unterricht teilnehmen.</p>
            <h3 className="text-sm font-bold mb-2">Inaktive Konten</h3>
            <p className="text-sm text-yoga-text/80 leading-relaxed mb-4">• Konten, die <strong>länger als 24 Monate</strong> nicht genutzt werden, werden aus Datenschutzgründen automatisch gelöscht. Du bekommst vorher eine Warn-E-Mail und kannst die Löschung jederzeit verhindern, indem du dich wieder anmeldest.</p>
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
