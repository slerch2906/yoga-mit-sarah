'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/auth'
import { fullLogout } from '@/lib/logout'
import { getCurrentAgbVersion, type AgbVersion } from '@/lib/agb-version'
import { promoteWaitlistOrOfferLate } from '@/lib/waitlist-promote'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

function InstallButton() {
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const [platform, setPlatform] = useState<'android'|'ios'|'desktop'|'installed'|'loading'>('loading')
  const [showGuide, setShowGuide] = useState(false)

  useEffect(() => {
    // Bereits als PWA installiert?
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setPlatform('installed')
      return
    }

    const ua = navigator.userAgent
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream
    const isAndroid = /Android/i.test(ua)
    const isMobileChrome = /Chrome/i.test(ua) && /Mobile/i.test(ua)

    if (isIOS) {
      setPlatform('ios')
    } else if (isAndroid || isMobileChrome) {
      setPlatform('android')
      const handler = (e: any) => {
        e.preventDefault()
        setInstallPrompt(e)
      }
      window.addEventListener('beforeinstallprompt', handler)
      return () => window.removeEventListener('beforeinstallprompt', handler)
    } else {
      setPlatform('desktop')
    }
  }, [])

  if (platform === 'installed' || platform === 'loading') return null

  async function handleInstall() {
    if (platform === 'ios') {
      setShowGuide(true)
      return
    }
    if (platform === 'android') {
      if (installPrompt) {
        installPrompt.prompt()
        const result = await installPrompt.userChoice
        if (result.outcome === 'accepted') setPlatform('installed')
        setInstallPrompt(null)
      } else {
        setShowGuide(true)
      }
      return
    }
    // Desktop
    setShowGuide(true)
  }

  return (
    <>
      <button onClick={handleInstall}
        className="w-full flex items-center justify-center gap-2 border border-yoga-border2 rounded-yoga py-3 text-sm font-semibold mb-3 hover:opacity-80 cursor-pointer bg-transparent text-yoga-text">
        <i className="ti ti-download text-lg" />
        App auf Startbildschirm installieren
      </button>

      {/* iOS Anleitung Modal */}
      {showGuide && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end modal-overlay" onClick={() => setShowGuide(false)}>
          <div className="bg-yoga-card w-full rounded-t-2xl p-6 pb-10" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">App installieren</h3>
              <button onClick={() => setShowGuide(false)} className="text-yoga-text/40 border-0 bg-transparent cursor-pointer">
                <i className="ti ti-x text-xl" />
              </button>
            </div>

            {/* iOS Safari */}
            {platform === 'ios' && (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-yoga-text text-yoga-bg flex items-center justify-center text-sm font-bold flex-shrink-0">1</div>
                  <div>
                    <p className="text-sm font-semibold">Teilen-Symbol tippen</p>
                    <p className="text-sm text-yoga-text/60">Tippe auf das <strong>⬆️ Teilen-Symbol</strong> unten in Safari</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-yoga-text text-yoga-bg flex items-center justify-center text-sm font-bold flex-shrink-0">2</div>
                  <div>
                    <p className="text-sm font-semibold">„Zum Home-Bildschirm" wählen</p>
                    <p className="text-sm text-yoga-text/60">Scrolle nach unten und tippe auf <strong>„Zum Home-Bildschirm"</strong></p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-yoga-text text-yoga-bg flex items-center justify-center text-sm font-bold flex-shrink-0">3</div>
                  <div>
                    <p className="text-sm font-semibold">„Hinzufügen" tippen</p>
                    <p className="text-sm text-yoga-text/60">Bestätige mit <strong>„Hinzufügen"</strong> oben rechts</p>
                  </div>
                </div>
              </div>
            )}

            {/* Android Chrome */}
            {platform === 'android' && (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-yoga-text text-yoga-bg flex items-center justify-center text-sm font-bold flex-shrink-0">1</div>
                  <div>
                    <p className="text-sm font-semibold">Menü öffnen</p>
                    <p className="text-sm text-yoga-text/60">Tippe auf die <strong>drei Punkte ⋮</strong> oben rechts in Chrome</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-yoga-text text-yoga-bg flex items-center justify-center text-sm font-bold flex-shrink-0">2</div>
                  <div>
                    <p className="text-sm font-semibold">„App installieren" tippen</p>
                    <p className="text-sm text-yoga-text/60">Wähle <strong>„App installieren"</strong> oder <strong>„Zum Startbildschirm hinzufügen"</strong></p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-yoga-text text-yoga-bg flex items-center justify-center text-sm font-bold flex-shrink-0">3</div>
                  <div>
                    <p className="text-sm font-semibold">„Installieren" bestätigen</p>
                    <p className="text-sm text-yoga-text/60">Tippe im Dialog auf <strong>„Installieren"</strong></p>
                  </div>
                </div>
              </div>
            )}

            {/* Desktop */}
            {platform === 'desktop' && (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-yoga-text text-yoga-bg flex items-center justify-center text-sm font-bold flex-shrink-0">1</div>
                  <div>
                    <p className="text-sm font-semibold">Installations-Symbol klicken</p>
                    <p className="text-sm text-yoga-text/60">Klicke auf das <strong>⊕ Symbol</strong> rechts in der Chrome-Adressleiste</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-yoga-text text-yoga-bg flex items-center justify-center text-sm font-bold flex-shrink-0">2</div>
                  <div>
                    <p className="text-sm font-semibold">„Installieren" klicken</p>
                    <p className="text-sm text-yoga-text/60">Bestätige mit <strong>„Installieren"</strong> im Dialog</p>
                  </div>
                </div>
              </div>
            )}

            <p className="text-xs text-yoga-text/40 text-center mt-6">
              Die App erscheint dann auf deinem Startbildschirm
            </p>
          </div>
        </div>
      )}
    </>
  )
}

export default function ProfilPage() {
  const [profile, setProfile] = useState<any>(null)
  const [credits, setCredits] = useState<any[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState('')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    try {
      const user = await getCurrentUser()
      if (!user) { window.location.href = '/login'; return }

      setUserEmail(user.email || '')
      const [{ data: prof }, { data: crds }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('credits').select('*').eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString()),
      ])
      if (prof) prof.email = user.email || prof.email
      const agb = await getCurrentAgbVersion(supabase)
      const currentOrder = agb?.sort_order ?? 1
      if (prof && (!prof.legal_accepted_at || (prof.agb_version ?? 0) < currentOrder)) {
        router.push('/rechtliches'); return
      }
      setCurrentAgb(agb)
      setProfile(prof)
      setCredits(crds || [])

      // Admin-Mehr-Menü: Nachricht + erweiterter System-Health laden
      if (prof?.is_admin) {
        const [annRes, healthRes] = await Promise.all([
          supabase.from('admin_announcement')
            .select('message, is_active, update_banner_version, update_banner_set_at, link_url, link_label')
            .eq('id', 1).maybeSingle(),
          supabase.rpc('get_system_health'),
        ])
        if (annRes.data) {
          setAnnText(annRes.data.message || '')
          setAnnActive(!!annRes.data.is_active)
          setAnnLinkUrl((annRes.data as any).link_url || '')
          setAnnLinkLabel((annRes.data as any).link_label || '')
          setBannerVersion((annRes.data as any).update_banner_version || null)
          setBannerSetAt((annRes.data as any).update_banner_set_at || null)
        }
        if (healthRes.data) {
          const h = healthRes.data as any
          setSystemHealth(h)
          // Backward-compat-Felder
          setCronHealth({
            active: !!h.cron?.active,
            last_status: h.cron?.last_status || 'unbekannt',
            minutes_ago: h.cron?.minutes_ago ?? 9999,
          })
          if (h.emails?.last_sent_at) setLastReminderAt(h.emails.last_sent_at)
        }
      }
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  async function handleSave(field: string) {
    const user = await getCurrentUser()
    if (!user) return
    const value = editValue.trim()

    // Sarah-Wunsch 2026-05-23: Form-Validierung pro Feld
    if (!value) { alert('Das Feld darf nicht leer sein.'); return }
    if (field === 'email') {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
      if (!emailOk) { alert('Bitte gib eine gültige E-Mail-Adresse ein (z.B. name@beispiel.de).'); return }
    }
    if (field === 'birthdate') {
      // Erwartet YYYY-MM-DD (date-input liefert das). Plausibilitäts-Check.
      const bd = new Date(value)
      if (isNaN(bd.getTime())) { alert('Geburtsdatum ist ungültig.'); return }
      const today = new Date()
      if (bd > today) { alert('Geburtsdatum darf nicht in der Zukunft liegen.'); return }
      const age = (today.getTime() - bd.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      if (age < 14) { alert('Du musst mindestens 14 Jahre alt sein.'); return }
      if (age > 120) { alert('Geburtsdatum scheint nicht zu stimmen.'); return }
    }

    if (field === 'email') {
      // Welle S2/M11 (Sarah 2026-05-27): Auth-Email UND Profile-Email muessen
      // synchron bleiben. Vorher wurde nur auth.updateUser aufgerufen — die
      // profiles-Tabelle hat die alte Email behalten, was an vielen Stellen
      // (Mails, Suche, Admin-Listen) zu Divergenz fuehrte. Jetzt:
      //  1) auth.updateUser, bei Fehler: abbrechen, kein profiles-Update.
      //  2) profiles.update, bei Fehler: best-effort auth-Rollback +
      //     Audit + admin_notifications.
      const previousEmail = userEmail
      const { error: authErr } = await supabase.auth.updateUser({ email: value })
      if (authErr) { alert('Fehler: ' + authErr.message); return }
      const { error: profileErr } = await supabase.from('profiles').update({ email: value }).eq('id', user.id)
      if (profileErr) {
        console.error('profiles.email update fehlgeschlagen:', profileErr)
        // Best-Effort: Auth-Email zuruecksetzen, damit Auth & Profile wieder synchron sind.
        if (previousEmail) {
          try { await supabase.auth.updateUser({ email: previousEmail }) } catch (e) { console.error('Auth-Rollback fehlgeschlagen:', e) }
        }
        try {
          await supabase.from('audit_log').insert({
            user_id: user.id, action: 'profile_email_update_failed',
            details: { attempted_email: value, previous_email: previousEmail, error_message: profileErr.message },
          })
        } catch (e) { console.error('Audit profile_email_update_failed:', e) }
        try {
          await supabase.from('admin_notifications').insert({
            type: 'profile_email_update_failed',
            message: 'Email-Aenderung im Profil fehlgeschlagen — Auth wurde zurueckgesetzt.',
            details: { user_id: user.id, attempted_email: value, previous_email: previousEmail, error_message: profileErr.message },
            read: false,
          })
        } catch (e) { console.error('admin_notifications profile_email_update_failed:', e) }
        alert('Email-Änderung fehlgeschlagen. Bitte erneut versuchen.')
        return
      }
      setUserEmail(value)
    } else {
      await supabase.from('profiles').update({ [field]: value }).eq('id', user.id)
    }
    setProfile((prev: any) => ({ ...prev, [field]: value }))
    setEditing(null)
    // Sarah-Wunsch 2026-05-25: Toast "Profil gespeichert" (3 Sek)
    setSavedToast(true)
    setTimeout(() => setSavedToast(false), 3000)
  }

  async function handleLogout() {
    await fullLogout()
  }

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)
  const [savedToast, setSavedToast] = useState(false) // Sarah-Wunsch 2026-05-25: Toast "Profil gespeichert"
  const [editingEmergency, setEditingEmergency] = useState(false)
  const [emergencyForm, setEmergencyForm] = useState({ name: '', phone: '' })
  // Sarah-Wunsch 2026-05-23: Admin-AGB-Verwaltung
  const [currentAgb, setCurrentAgb] = useState<AgbVersion | null>(null)
  const [showAgbForm, setShowAgbForm] = useState(false)
  const [agbLabel, setAgbLabel] = useState('')
  const [agbChangelog, setAgbChangelog] = useState('')
  const [pushingAgb, setPushingAgb] = useState(false)

  // Sarah-Wunsch 2026-05-23: Mehr-Menü für Admin (Nachricht, Bulk-Mail, Status, Protokoll)
  const [annText, setAnnText] = useState('')
  const [annActive, setAnnActive] = useState(false)
  const [annLinkUrl, setAnnLinkUrl] = useState('')
  const [annLinkLabel, setAnnLinkLabel] = useState('')
  const [savingAnn, setSavingAnn] = useState(false)
  // Update-Banner (Option C: manueller Trigger mit klarem Status)
  const [bannerVersion, setBannerVersion] = useState<string | null>(null)
  const [bannerSetAt, setBannerSetAt] = useState<string | null>(null)
  const [savingUpdateBanner, setSavingUpdateBanner] = useState(false)
  const [bulkSubject, setBulkSubject] = useState('')
  const [bulkBody, setBulkBody] = useState('')
  const [sendingBulk, setSendingBulk] = useState(false)
  const [lastReminderAt, setLastReminderAt] = useState<string | null>(null)
  const [cronHealth, setCronHealth] = useState<{ active: boolean; last_status: string; minutes_ago: number } | null>(null)
  // Erweiterter System-Health (Sarah-Wunsch 2026-05-23)
  const [systemHealth, setSystemHealth] = useState<any>(null)
  // Sarah-Wunsch 2026-05-24: Email-Fehler-Details + Erledigt-Markierung
  const [showFailuresModal, setShowFailuresModal] = useState(false)
  const [emailFailures, setEmailFailures] = useState<any[]>([])
  const [showProtocol, setShowProtocol] = useState(false)
  const [protocolItems, setProtocolItems] = useState<any[]>([])
  const [loadingProtocol, setLoadingProtocol] = useState(false)

  async function handleDeleteAccount() {
    if (!deleteConfirmed) return
    const user = await getCurrentUser()
    if (!user) return

    const fullName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim()
    const email = userEmail || profile?.email || ''

    // DSGVO: Anonymisieren statt hart löschen
    // 1) Personendaten anonymisieren
    await supabase.from('profiles').update({
      first_name: 'Gelöschter',
      last_name: 'Nutzer',
      email: null,
      emergency_name: null,
      emergency_phone: null,
      legal_accepted_at: null,
    }).eq('id', user.id)

    // 2) Legal Acceptances anonymisieren
    await supabase.from('legal_acceptances').update({
      full_name: 'Gelöschter Nutzer',
      ip_address: null,
      user_agent: null,
      emergency_contact: null,
      phone: null,
    }).eq('user_id', user.id)

    // 3) Warteliste-Einträge komplett entfernen
    await supabase.from('waitlist').delete().eq('user_id', user.id)

    // Sarah-Wunsch 2026-05-25: ZUKÜNFTIGE Buchungen stornieren + Kurs-Teilnahmen
    // entfernen, damit Plätze für andere Yogis (Wartelisten) frei werden.
    // 3a) Alle aktiven Buchungen mit Session-Daten laden, dann clientseitig auf zukünftige
    //     Sessions filtern. PostgREST kann nicht direkt auf nested session.date filtern.
    const today = new Date().toISOString().split('T')[0]
    const { data: allActiveBookings } = await supabase.from('bookings')
      .select('id, session_id, session:sessions!bookings_session_id_fkey(date, time_start)')
      .eq('user_id', user.id).eq('status', 'active')
    const sessionsToPromote: string[] = (allActiveBookings || [])
      .filter((b: any) => b.session?.date && b.session.date >= today)
      .map((b: any) => b.session_id)
    // 3b) Buchungen auf cancelled setzen (Trigger trg_sync_credit_used schreibt Credit zurück
    //     — Credit-Anzeige zerlegt sich später eh durch profil-Anonymisierung)
    if (sessionsToPromote.length > 0) {
      await supabase.from('bookings').update({
        status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false, cancelled_by: 'self',
      }).eq('user_id', user.id).eq('status', 'active').in('session_id', sessionsToPromote)
    }
    // 3c) Enrollments komplett entfernen — Yogi ist nicht mehr Kursteilnehmer
    await supabase.from('enrollments').delete().eq('user_id', user.id)
    // 3d) Für jede so freigewordene Stunde: Auto-Promote der Warteliste triggern.
    //     Läuft parallel (best-effort) — Anonymisierung soll nicht warten.
    for (const sId of sessionsToPromote) {
      promoteWaitlistOrOfferLate(supabase, sId).catch(e => console.error('promote on delete:', e))
    }

    // 3d-bis) Sarah-Fix 2026-05-29 (Fall 4, "voll absichern"): ALLE verbleibenden
    //   Yogi-Ressourcen EXPLIZIT löschen — NICHT auf den FK-Cascade des Auth-Deletes
    //   verlassen. Der Auth-Delete läuft unten fire-and-forget; schlägt er fehl,
    //   blieben Buchungshistorie/Credits sonst beim (anonymisierten) Profil hängen,
    //   obwohl die Bestätigungs-Mail dem Yogi "Buchungshistorie gelöscht / Credits
    //   verfallen" zusichert. Gleiche robuste Reihenfolge wie im Admin-Lösch-Pfad
    //   (app/admin/yogis/[id]/page.tsx). enrollments + waitlist sind oben bereits weg.
    //   Erst NACH Cancel+Promote oben, damit Trigger/Nachrücken korrekt liefen.
    await supabase.from('bookings').delete().eq('user_id', user.id)
    await supabase.from('credits').delete().eq('user_id', user.id)
    await supabase.from('notification_log').delete().eq('user_id', user.id)
    await supabase.from('waitlist_offers').delete().eq('user_id', user.id)
    // Finding E1 (2026-05-29): Kursabbruch-Wahl-Tokens räumen — sonst blockiert ihr
    // FK (course_cancellation_responses.user_id → profiles, NO ACTION) die profiles-
    // Cascade beim Auth-Delete → Route 502, Auth-User bliebe trotz "gelöscht"-Mail.
    await supabase.from('course_cancellation_responses').delete().eq('user_id', user.id)

    // 3e) Audit-Log Einträge anonymisieren (DSGVO – PII aus details JSONB entfernen)
    try { await supabase.rpc('anonymize_user_audit_logs' as any, { target_user_id: user.id }) } catch {}

    // 4) Sarah-Fix 2026-06-01: Yogi-Bestaetigungsmail, Admin-Info-Mail UND die
    //    Admin-Benachrichtigung laufen jetzt SERVER-SEITIG in /api/delete-account
    //    (Service-Rolle, RLS-immun). Vorher liefen sie hier clientseitig als Yogi und
    //    scheiterten still an der "Admin only"-RLS von admin_notifications bzw. brachen
    //    durch das nachfolgende Logout/Navigieren ab → Sarah bekam keine Info-Mail.
    //    email + fullName + firstName werden unten an die Route uebergeben.

    // 6) Auth User löschen + sofort ausloggen
    // Welle S1/H1 (Sarah 2026-05-27): Bearer-Token VOR signOut greifen — die API-Route
    // braucht ihn um den Caller zu authentifizieren (vorher: unauthorized POST).
    let accessToken = ''
    try {
      const { data: { session: sess } } = await supabase.auth.getSession()
      accessToken = sess?.access_token || ''
    } catch {}

    // Erst lokal ausloggen (Session löschen), dann Auth-User löschen
    try { await supabase.auth.signOut({ scope: 'global' }) } catch {}
    localStorage.clear()
    sessionStorage.clear()

    // Auth-User asynchron löschen (muss nach signOut passieren)
    fetch('/api/delete-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ userId: user.id, email, fullName, firstName: profile?.first_name || 'Yogi' })
    }).catch(e => console.error('Delete account:', e))

    // Sofort zur Login-Seite, keine Rückkehr möglich
    window.location.replace('/login')
  }

  const totalFreeCredits = credits.reduce((sum, c) => sum + Math.max(0, c.total - c.used), 0)
  const firstExpiry = [...credits].sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())[0]

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>

  const fields = [
    { key: 'first_name', label: 'Vorname',     value: profile?.first_name },
    { key: 'last_name',  label: 'Nachname',    value: profile?.last_name },
    { key: 'birthdate',  label: 'Geburtsdatum', value: profile?.birthdate },
    { key: 'email',      label: 'E-Mail',       value: userEmail || profile?.email },
  ]
  // Geburtsdatum im deutschen Format anzeigen (DB liefert YYYY-MM-DD)
  function formatBirthdate(iso: string | null | undefined): string {
    if (!iso) return '—'
    const [y, m, d] = iso.split('-')
    return `${d}.${m}.${y}`
  }

  const rechtliches = [
    { label: 'Datenschutzerklärung', url: 'https://yogamitsarah.me/privacy-policy/' },
    { label: 'Impressum',            url: 'https://www.yogamitsarah.me/impressum' },
    { label: 'AGB',                  url: 'https://www.yogamitsarah.me/agb' },
  ]

  const isAdmin = !!profile?.is_admin

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title={isAdmin ? 'Mehr' : 'Mein Profil'} isAdmin={isAdmin} />
      <div className="px-4 py-4">
        {isAdmin && (
          <button onClick={() => router.push('/admin/dashboard')}
            className="flex items-center gap-1 text-sm text-yoga-text/60 mb-4 hover:opacity-80 md:flex hidden">
            <i className="ti ti-arrow-left" /> Zurück zum Dashboard
          </button>
        )}

        {isAdmin ? (
          // ────────────────────────────────────────────────────────────────
          // ADMIN-Mehr-Menü (Sarah-Wunsch 2026-05-23)
          // Reihenfolge: Nachricht (über AGB), AGB, Passwort, System-Status,
          // Bulk-Mail, Protokoll (ausklappbar) am Ende.
          // ────────────────────────────────────────────────────────────────
          <>
            {/* 1) Nachricht für Yogis (Sprechblase auf Wochenseite) */}
            <p className="section-label">Nachricht für Yogis</p>
            <div className="card mb-4">
              <p className="text-xs text-yoga-text/55 mb-3">Dein Sprechblasen-Text auf der Wochenseite.</p>
              <textarea
                className="w-full bg-white border border-yoga-border2 rounded-yoga px-3 py-2 mb-3 text-sm text-yoga-text outline-none focus:border-yoga-text/40 transition-colors"
                rows={3} value={annText}
                onChange={e => setAnnText(e.target.value)}
                placeholder="z.B. Ich wünsche euch eine wunderschöne Woche! 💛" />
              <label className="flex items-center justify-between mb-3 cursor-pointer">
                <span className="text-sm font-semibold">Nachricht aktiv anzeigen</span>
                <input type="checkbox" className="w-5 h-5 cursor-pointer" style={{ accentColor: '#3d3a39' }}
                  checked={annActive}
                  onChange={e => setAnnActive(e.target.checked)} />
              </label>
              {/* Optionaler Button mit Link — z.B. um Charity-Stunde zu promoten */}
              <div className="space-y-2 mb-3">
                <p className="text-xs text-yoga-text/55">Optional: Button mit Link (z.B. zu kostenloser Stunde)</p>
                <input
                  className="w-full bg-white border border-yoga-border2 rounded-yoga px-3 py-2 text-sm text-yoga-text outline-none focus:border-yoga-text/40 transition-colors"
                  value={annLinkUrl}
                  onChange={e => setAnnLinkUrl(e.target.value)}
                  placeholder="z.B. /kurse/abc-123" />
                <input
                  className="w-full bg-white border border-yoga-border2 rounded-yoga px-3 py-2 text-sm text-yoga-text outline-none focus:border-yoga-text/40 transition-colors"
                  value={annLinkLabel}
                  onChange={e => setAnnLinkLabel(e.target.value)}
                  placeholder="z.B. Jetzt anmelden" />
              </div>
              <button disabled={savingAnn}
                onClick={async () => {
                  setSavingAnn(true)
                  const { error } = await supabase.from('admin_announcement')
                    .update({
                      message: annText, is_active: annActive,
                      link_url: annLinkUrl.trim() || null,
                      link_label: annLinkLabel.trim() || null,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', 1)
                  setSavingAnn(false)
                  if (error) alert('Fehler beim Speichern: ' + error.message)
                  else alert('Nachricht gespeichert.')
                }} className="w-full btn-primary text-sm disabled:opacity-50">
                {savingAnn ? 'Speichere…' : 'Speichern'}
              </button>
            </div>

            {/* 2) Bulk-Mail an alle Yogis */}
            <p className="section-label">E-Mail an alle Yogis</p>
            <div className="card mb-4">
              <p className="text-xs text-yoga-text/55 mb-3">Versende eine E-Mail an alle Yogis gleichzeitig.</p>
              <div className="space-y-3">
                <div>
                  <label className="field-label">Betreff</label>
                  <input
                    className="w-full bg-white border border-yoga-border2 rounded-yoga px-3 py-2 text-sm text-yoga-text outline-none focus:border-yoga-text/40 transition-colors"
                    value={bulkSubject}
                    onChange={e => setBulkSubject(e.target.value)}
                    placeholder="z.B. Sommerpause vom 1.-15. August" />
                </div>
                <div>
                  <label className="field-label">Text</label>
                  <p className="text-[11px] text-yoga-text/45 mb-1">Hallo [Vorname],</p>
                  <textarea
                    className="w-full bg-white border border-yoga-border2 rounded-yoga px-3 py-2 text-sm text-yoga-text outline-none focus:border-yoga-text/40 transition-colors"
                    rows={5} value={bulkBody}
                    onChange={e => setBulkBody(e.target.value)}
                    placeholder="z.B. ich wollte euch kurz erinnern, dass die Sommerpause vom 1.-15. August stattfindet…" />
                </div>
                <button disabled={sendingBulk || !bulkSubject.trim() || !bulkBody.trim()}
                  onClick={async () => {
                    if (!confirm(`E-Mail an ALLE aktiven Yogis senden?\n\nBetreff: ${bulkSubject}\n\nDiese Aktion lässt sich nicht rückgängig machen.`)) return
                    setSendingBulk(true)
                    const { data: { session } } = await supabase.auth.getSession()
                    const res = await fetch('/api/admin/bulk-mail', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || ''}` },
                      body: JSON.stringify({ subject: bulkSubject, body: bulkBody }),
                    })
                    const json = await res.json().catch(() => ({}))
                    setSendingBulk(false)
                    if (!res.ok) { alert('Fehler: ' + (json?.error || res.status)); return }
                    alert(`✅ ${json.sent}/${json.total} Mails versendet${json.failed ? ` (${json.failed} fehlgeschlagen)` : ''}.`)
                    setBulkSubject(''); setBulkBody('')
                  }}
                  className="w-full btn-primary text-sm disabled:opacity-50">
                  {sendingBulk ? 'Sende…' : 'An alle Yogis senden'}
                </button>
              </div>
            </div>

            {/* 3) AGB-Verwaltung */}
            <p className="section-label">AGB-Verwaltung</p>
            <div className="card mb-4">
              <p className="text-sm mb-3">
                Aktuelle Version: <strong>{currentAgb?.label || 'Dezember 2025'}</strong>
              </p>
              {!showAgbForm ? (
                <button onClick={() => { setShowAgbForm(true); setAgbLabel(''); setAgbChangelog('') }}
                  className="btn-secondary text-sm">
                  <i className="ti ti-edit mr-1" />Neue AGB-Version pushen
                </button>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="field-label">Versions-Bezeichnung (wie auf der Webseite)</label>
                    <input className="field-input" value={agbLabel}
                      onChange={e => setAgbLabel(e.target.value)}
                      placeholder="z.B. Januar 2026" />
                  </div>
                  <div>
                    <label className="field-label">Was hat sich geändert? (1-3 Stichpunkte)</label>
                    <textarea className="field-input" rows={4} value={agbChangelog}
                      onChange={e => setAgbChangelog(e.target.value)}
                      placeholder={'z.B.\nStornofrist von 4h auf 3h verkürzt\nVorholfenster auf 10 Tage'} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowAgbForm(false)}
                      className="flex-1 btn-secondary text-sm">Abbrechen</button>
                    <button disabled={pushingAgb || !agbLabel.trim() || !agbChangelog.trim()}
                      onClick={async () => {
                        if (!confirm(`Neue AGB-Version "${agbLabel}" pushen?\n\nAlle Yogis werden beim nächsten Login zur Re-Bestätigung umgeleitet und sehen deinen Changelog.`)) return
                        setPushingAgb(true)
                        const newOrder = (currentAgb?.sort_order ?? 0) + 1
                        const { data: inserted, error: insErr } = await supabase.from('agb_versions').insert({
                          label: agbLabel.trim(), changelog: agbChangelog.trim(), sort_order: newOrder,
                        }).select('*').single()
                        if (insErr || !inserted) {
                          alert('Fehler beim Speichern: ' + (insErr?.message || ''))
                          setPushingAgb(false); return
                        }
                        const oldOrder = currentAgb?.sort_order ?? 1
                        const { count } = await supabase.from('profiles')
                          .update({ agb_version: oldOrder })
                          .gte('agb_version', oldOrder)
                          .select('id', { count: 'exact', head: true })
                        alert(`AGB-Version "${agbLabel}" gepusht. ${count ?? 0} Yogis müssen beim nächsten Login neu bestätigen.`)
                        setCurrentAgb(inserted as AgbVersion)
                        setShowAgbForm(false); setPushingAgb(false)
                      }}
                      className="flex-1 btn-primary text-sm disabled:opacity-50">
                      {pushingAgb ? 'Pushe…' : 'Pushen & Yogis benachrichtigen'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 4) System-Status / App-Info */}
            <p className="section-label">System-Status</p>
            <div className="card mb-4 text-sm space-y-2">
              {/* Gesamt-Ampel oben — fasst alle Indikatoren zusammen */}
              {(() => {
                if (!systemHealth) return (
                  <div className="bg-yoga-gray rounded-yoga px-3 py-2 text-xs text-yoga-text/50">
                    Lade Status…
                  </div>
                )
                const cron = systemHealth.cron
                const failures = systemHealth.failures_7d ?? 0
                const cronOK = cron?.active && cron?.last_status === 'succeeded' && (cron?.minutes_ago ?? 999) <= 20
                const noFails = failures === 0
                const allOK = cronOK && noFails
                return (
                  <div className={`rounded-yoga px-3 py-2.5 text-sm font-semibold ${
                    allOK
                      ? 'bg-green-50 text-green-800 border border-green-200'
                      : 'bg-yoga-red-bg text-yoga-red-text border border-yoga-red-text/20'
                  }`}>
                    {allOK ? '✅ Alles in Ordnung' : '⚠️ Probleme erkannt — siehe unten'}
                  </div>
                )
              })()}

              {/* 1. Reminder-Cron */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-yoga-text/60">Reminder-Cron</span>
                {(() => {
                  if (!cronHealth) return <span className="text-xs text-yoga-text/40">⚪ lädt…</span>
                  if (!cronHealth.active) return <span className="text-xs text-yoga-red-text">❌ deaktiviert</span>
                  if (cronHealth.minutes_ago > 20)
                    return <span className="text-xs text-yoga-red-text">❌ letzter Lauf vor {cronHealth.minutes_ago} Min</span>
                  if (cronHealth.last_status !== 'succeeded')
                    return <span className="text-xs text-yoga-red-text">❌ letzter Lauf: {cronHealth.last_status}</span>
                  return <span className="text-xs text-green-700">✅ läuft (vor {cronHealth.minutes_ago} Min)</span>
                })()}
              </div>

              {/* 2. Email-Versand (letzte 24h) */}
              <div className="flex items-center justify-between">
                <span className="text-yoga-text/60">Email-Versand (24h)</span>
                <span className="text-xs text-yoga-text/70">
                  {systemHealth ? `${systemHealth.emails?.sent_24h ?? 0} Mails versendet` : '…'}
                </span>
              </div>

              {/* 3. Email-Failures (7 Tage) — klickbar wenn > 0 */}
              <div className="flex items-center justify-between">
                <span className="text-yoga-text/60">Email-Fehler (7d)</span>
                {(() => {
                  const f = systemHealth?.failures_7d ?? null
                  if (f === null) return <span className="text-xs text-yoga-text/40">…</span>
                  if (f === 0) return <span className="text-xs text-green-700">✅ keine</span>
                  // Klickbar — öffnet Modal mit Details
                  return (
                    <button onClick={async () => {
                      const { data } = await supabase.rpc('list_email_failures' as any)
                      setEmailFailures((data as any[]) || [])
                      setShowFailuresModal(true)
                    }}
                      className="text-xs text-yoga-red-text underline cursor-pointer hover:opacity-80">
                      ❌ {f} fehlgeschlagen — Details
                    </button>
                  )
                })()}
              </div>

              {/* 4. App-Aktivität */}
              <div className="flex items-center justify-between">
                <span className="text-yoga-text/60">App-Aktivität (24h)</span>
                <span className="text-xs text-yoga-text/70">
                  {systemHealth ? `${systemHealth.activity?.bookings_24h ?? 0} neue Buchungen` : '…'}
                </span>
              </div>

              {/* App-Version + Letzte Mail als Info-Zeilen */}
              <div className="flex items-center justify-between pt-1 border-t border-yoga-border">
                <span className="text-yoga-text/60 text-xs">App-Version</span>
                <span className="font-mono text-[10px] text-yoga-text/50">
                  {process.env.NEXT_PUBLIC_BUILD_SHA || 'local'} · {process.env.NEXT_PUBLIC_BUILD_DATE || '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-yoga-text/60 text-xs">Letzte Mail</span>
                <span className="text-[10px] text-yoga-text/50">
                  {(() => {
                    if (!lastReminderAt) return 'noch keine'
                    const ago = Math.round((Date.now() - new Date(lastReminderAt).getTime()) / 60000)
                    if (ago < 60) return `vor ${ago} Min`
                    if (ago < 1440) return `vor ${Math.round(ago/60)} Std`
                    return `vor ${Math.round(ago/1440)} Tagen`
                  })()}
                </span>
              </div>

              {/* Update-Banner Status + Aktionen (Sarah-Wunsch 2026-05-23, klar statt Toggle) */}
              <div className="pt-3 mt-1 border-t border-yoga-border">
                <div className="text-xs font-semibold text-yoga-text/70 mb-2">Update-Banner für Yogis</div>
                {(() => {
                  const currentSha = process.env.NEXT_PUBLIC_BUILD_SHA || 'local'
                  const bannerAgo = bannerSetAt
                    ? Math.round((Date.now() - new Date(bannerSetAt).getTime()) / 86400000)
                    : null

                  // 3 Zustände: KEIN Banner / Banner zur AKTUELLEN Version / Banner zur ALTEN Version
                  const state =
                    !bannerVersion ? 'off' :
                    bannerVersion === currentSha ? 'current' : 'outdated'

                  const pushBanner = async () => {
                    setSavingUpdateBanner(true)
                    const now = new Date().toISOString()
                    const { error } = await supabase.from('admin_announcement')
                      .update({ update_banner_version: currentSha, update_banner_set_at: now, updated_at: now })
                      .eq('id', 1)
                    setSavingUpdateBanner(false)
                    if (error) { alert('Fehler: ' + error.message); return }
                    setBannerVersion(currentSha); setBannerSetAt(now)
                  }
                  const turnOff = async () => {
                    if (!confirm('Banner ausschalten? Yogis sehen ihn dann nicht mehr.')) return
                    setSavingUpdateBanner(true)
                    const { error } = await supabase.from('admin_announcement')
                      .update({ update_banner_version: null, updated_at: new Date().toISOString() })
                      .eq('id', 1)
                    setSavingUpdateBanner(false)
                    if (error) { alert('Fehler: ' + error.message); return }
                    setBannerVersion(null)
                  }

                  if (state === 'off') return (
                    <>
                      <p className="text-[11px] text-yoga-text/55 mb-2 leading-snug">
                        Aktuell ist kein Banner aktiv. Yogis sehen neue Versionen automatisch beim
                        nächsten Reload. Wenn du sie aktiv informieren willst (z.B. nach wichtigem
                        Feature) — Banner pushen.
                      </p>
                      <button onClick={pushBanner} disabled={savingUpdateBanner}
                        className="w-full btn-secondary text-xs py-2 disabled:opacity-50">
                        Banner an Yogis pushen
                      </button>
                    </>
                  )

                  if (state === 'current') return (
                    <>
                      <p className="text-[11px] text-green-700 mb-2 leading-snug">
                        ✅ Banner ist auf aktueller Version — Yogis bekommen den Reload-Hinweis.
                        {bannerAgo !== null && ` Gesetzt vor ${bannerAgo === 0 ? 'wenigen Stunden' : `${bannerAgo} Tag(en)`}.`}
                      </p>
                      <button onClick={turnOff} disabled={savingUpdateBanner}
                        className="w-full btn-secondary text-xs py-2 disabled:opacity-50">
                        Banner ausschalten
                      </button>
                    </>
                  )

                  // state === 'outdated'
                  return (
                    <>
                      <p className="text-[11px] text-yoga-amber-text mb-2 leading-snug">
                        ⚠️ Du hast seit dem letzten Banner-Push neue Versionen deployt
                        {bannerAgo !== null && ` (Banner ist ${bannerAgo === 0 ? 'von heute' : `${bannerAgo} Tag(e) alt`})`}.
                        Banner zeigt Yogis noch die alte Version <code className="font-mono text-[10px]">{bannerVersion}</code>.
                      </p>
                      <div className="flex gap-2">
                        <button onClick={pushBanner} disabled={savingUpdateBanner}
                          className="flex-1 btn-primary text-xs py-2 disabled:opacity-50">
                          Auf aktuelle Version aktualisieren
                        </button>
                        <button onClick={turnOff} disabled={savingUpdateBanner}
                          className="btn-secondary text-xs py-2 px-3 disabled:opacity-50">
                          Aus
                        </button>
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>

            {/* 5) Passwort */}
            <p className="section-label">Passwort</p>
            <div className="card mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Passwort ändern</div>
                  <div className="text-xs text-yoga-text/50 mt-0.5">••••••••</div>
                </div>
                <button onClick={() => router.push('/profil/passwort')}
                  className="text-xs border border-yoga-border2 rounded-full px-3 py-1 text-yoga-text/60">
                  Ändern
                </button>
              </div>
            </div>

            {/* 6) Ausloggen (im Admin-Block VOR Protokoll, statt im shared Footer) */}
            <button onClick={handleLogout} className="btn-secondary mb-3">Ausloggen</button>

            {/* 7) Protokoll (ausklappbar) */}
            <button onClick={async () => {
              const next = !showProtocol
              setShowProtocol(next)
              if (next && protocolItems.length === 0) {
                setLoadingProtocol(true)
                const { data } = await supabase.from('audit_log')
                  .select('id, action, details, created_at, user_id')
                  .order('created_at', { ascending: false }).limit(50)
                setProtocolItems(data || [])
                setLoadingProtocol(false)
              }
            }} className="w-full flex items-center justify-between section-label mb-2 cursor-pointer hover:opacity-80">
              <span>Protokoll (Audit-Log)</span>
              <i className={`ti ti-chevron-down text-base transition-transform ${showProtocol ? 'rotate-180' : ''}`} />
            </button>
            {showProtocol && (
              <div className="card mb-4 p-0 overflow-hidden">
                {loadingProtocol ? (
                  <div className="px-4 py-6 text-center text-yoga-text/40 text-sm">Lade…</div>
                ) : protocolItems.length === 0 ? (
                  <div className="px-4 py-6 text-center text-yoga-text/40 text-sm">Keine Einträge</div>
                ) : protocolItems.map((it, i) => (
                  <div key={it.id} className={`px-3 py-2 ${i < protocolItems.length - 1 ? 'border-b border-yoga-border' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono text-yoga-text/70">{it.action}</span>
                      <span className="text-[10px] text-yoga-text/40">
                        {new Date(it.created_at).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {it.details && (
                      <pre className="text-[10px] text-yoga-text/50 mt-1 truncate" title={JSON.stringify(it.details, null, 2)}>
                        {typeof it.details === 'object' ? JSON.stringify(it.details).slice(0, 100) : String(it.details).slice(0,100)}
                      </pre>
                    )}
                  </div>
                ))}
                {protocolItems.length >= 50 && (
                  <div className="px-3 py-2 text-center">
                    <a href="/admin/protokoll" className="text-xs text-yoga-text/60 hover:underline">
                      Alle Einträge ansehen →
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Email-Fehler Detail-Modal (Sarah-Wunsch 2026-05-24) — öffnet
                sich vom System-Status-Card-Klick aus. Zeigt Empfänger,
                Betreff, Fehler-Text + Button "Als erledigt markieren" das
                admin_notifications.read=true setzt. get_system_health zählt
                nur read=false → ❌ verschwindet sofort aus System-Status. */}
            {showFailuresModal && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-end modal-overlay" onClick={() => setShowFailuresModal(false)}>
                <div className="bg-yoga-card w-full max-w-md mx-auto rounded-t-2xl p-5 pb-10 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold">Email-Fehler (letzte 7 Tage)</h3>
                    <button onClick={() => setShowFailuresModal(false)} className="text-yoga-text/40 border-0 bg-transparent cursor-pointer">
                      <i className="ti ti-x text-xl" />
                    </button>
                  </div>
                  {emailFailures.length === 0 ? (
                    <p className="text-sm text-yoga-text/60 text-center py-4">Keine offenen Fehler.</p>
                  ) : (
                    <div className="space-y-3">
                      {emailFailures.map(f => (
                        <div key={f.id} className="card text-xs space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-yoga-red-text">
                              <i className="ti ti-mail-x mr-1" />Zustellung gescheitert
                            </span>
                            <span className="text-yoga-text/40">
                              {new Date(f.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                            </span>
                          </div>
                          <div><span className="text-yoga-text/50">An:</span> <span className="font-mono">{f.recipient}</span></div>
                          <div><span className="text-yoga-text/50">Betreff:</span> {f.subject}</div>
                          <div className="bg-yoga-red-bg/40 rounded p-2 text-yoga-red-text text-[11px] leading-snug">
                            {f.status > 0 && <span className="font-semibold">HTTP {f.status}: </span>}
                            {f.error}
                          </div>
                          <button onClick={async () => {
                            await supabase.rpc('acknowledge_email_failure' as any, { failure_id: f.id })
                            setEmailFailures(prev => prev.filter(x => x.id !== f.id))
                            const { data: h } = await supabase.rpc('get_system_health')
                            setSystemHealth(h)
                          }}
                            className="w-full btn-ghost text-xs py-1.5 mt-1">
                            <i className="ti ti-check mr-1" />Als erledigt markieren
                          </button>
                        </div>
                      ))}
                      <p className="text-[10px] text-yoga-text/40 text-center pt-2 leading-snug">
                        „Als erledigt" entfernt den Eintrag aus dem System-Status, behält ihn aber im Audit-Log.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          // ────────────────────────────────────────────────────────────────
          // YOGI-Profil (unverändert)
          // ────────────────────────────────────────────────────────────────
          <>
        <p className="section-label">Meine Daten</p>
        <div className="card mb-4 p-0 overflow-hidden">
          {fields.map((f, i) => (
            <div key={f.key} className={`px-4 py-3 ${i < fields.length - 1 ? 'border-b border-yoga-border' : ''}`}>
              {editing === f.key ? (
                <div className="flex items-center gap-2">
                  <input className="field-input flex-1" value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    type={f.key === 'email' ? 'email' : f.key === 'birthdate' ? 'date' : 'text'}
                    max={f.key === 'birthdate' ? new Date().toISOString().split('T')[0] : undefined} />
                  <button onClick={() => handleSave(f.key)}
                    className="text-sm bg-yoga-text text-yoga-bg rounded-full px-3 py-1.5 font-semibold">Speichern</button>
                  <button onClick={() => setEditing(null)} className="text-sm text-yoga-text/50">Abbrechen</button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-yoga-text/50">{f.label}</div>
                    <div className="text-sm font-semibold mt-0.5">
                      {f.key === 'birthdate' ? formatBirthdate(f.value) : (f.value || '—')}
                    </div>
                  </div>
                  <button onClick={() => { setEditing(f.key); setEditValue(f.value || '') }}
                    className="text-xs border border-yoga-border2 rounded-full px-3 py-1 text-yoga-text/60">
                    {f.key === 'birthdate' && !f.value ? 'Hinzufügen' : 'Ändern'}
                  </button>
                </div>
              )}
            </div>
          ))}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-yoga-text/50">Passwort</div>
                <div className="text-sm font-semibold mt-0.5">••••••••</div>
              </div>
              <button onClick={() => router.push('/profil/passwort')}
                className="text-xs border border-yoga-border2 rounded-full px-3 py-1 text-yoga-text/60">Ändern</button>
            </div>
          </div>
        </div>

        <p className="section-label">Notfallkontakt</p>
        <div className="card mb-4">
          <p className="text-xs text-yoga-text/50 mb-3">Optional – für Notfälle während des Kurses</p>
          {!editingEmergency ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                {profile?.emergency_name || profile?.emergency_phone ? (
                  <div className="space-y-0.5">
                    {profile.emergency_name && <p className="text-sm font-semibold truncate">{profile.emergency_name}</p>}
                    {profile.emergency_phone && <p className="text-sm text-yoga-text/60 truncate">{profile.emergency_phone}</p>}
                  </div>
                ) : (
                  <p className="text-sm text-yoga-text/40">Noch nicht hinterlegt</p>
                )}
              </div>
              <button onClick={() => {
                setEmergencyForm({ name: profile?.emergency_name || '', phone: profile?.emergency_phone || '' })
                setEditingEmergency(true)
              }} className="text-xs border border-yoga-border2 rounded-full px-3 py-1 text-yoga-text/60 flex-shrink-0">
                {profile?.emergency_name ? 'Ändern' : 'Hinzufügen'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="field-label">Name</label>
                <input className="field-input" placeholder="z.B. Max Mustermann" autoFocus
                  value={emergencyForm.name}
                  onChange={e => setEmergencyForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="field-label">Telefonnummer</label>
                <input className="field-input" placeholder="z.B. 0151 12345678" type="tel"
                  value={emergencyForm.phone}
                  onChange={e => setEmergencyForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditingEmergency(false)} className="btn-secondary flex-1 text-sm">Abbrechen</button>
                <button onClick={async () => {
                  await supabase.from('profiles').update({
                    emergency_name: emergencyForm.name || null,
                    emergency_phone: emergencyForm.phone || null,
                  }).eq('id', profile.id)
                  setProfile((p: any) => ({ ...p, emergency_name: emergencyForm.name, emergency_phone: emergencyForm.phone }))
                  setEditingEmergency(false)
                }} className="btn-primary flex-1 text-sm">Speichern</button>
              </div>
            </div>
          )}
        </div>

        {/* Benachrichtigungen */}
        <p className="section-label">Benachrichtigungen</p>
        <div className="card mb-2 p-0 overflow-hidden">
          {/* Bestätigungen meiner Buchungen */}
          <label className="flex items-center justify-between px-4 py-3 border-b border-yoga-border cursor-pointer">
            <div className="flex-1 pr-3">
              <div className="text-sm font-semibold">Bestätigungen meiner Buchungen</div>
              <div className="text-xs text-yoga-text/50 mt-0.5">Email bei eigener Buchung oder Abmeldung</div>
            </div>
            <input type="checkbox" className="w-5 h-5 cursor-pointer flex-shrink-0" style={{ accentColor: '#3d3a39' }}
              checked={profile?.notify_booking_confirmations !== false}
              onChange={async e => {
                const v = e.target.checked
                setProfile((p: any) => ({ ...p, notify_booking_confirmations: v }))
                await supabase.from('profiles').update({ notify_booking_confirmations: v }).eq('id', profile.id)
              }} />
          </label>

          {/* Wartelisten-Bestätigung */}
          <label className="flex items-center justify-between px-4 py-3 cursor-pointer">
            <div className="flex-1 pr-3">
              <div className="text-sm font-semibold">Wartelisten-Bestätigung</div>
              <div className="text-xs text-yoga-text/50 mt-0.5">Email beim Eintragen auf eine Warteliste</div>
            </div>
            <input type="checkbox" className="w-5 h-5 cursor-pointer flex-shrink-0" style={{ accentColor: '#3d3a39' }}
              checked={profile?.notify_waitlist_joined !== false}
              onChange={async e => {
                const v = e.target.checked
                setProfile((p: any) => ({ ...p, notify_waitlist_joined: v }))
                await supabase.from('profiles').update({ notify_waitlist_joined: v }).eq('id', profile.id)
              }} />
          </label>
        </div>

        {/* Stunden-Erinnerung — kompaktes Inline-Layout wie die anderen Card-Felder */}
        <div className="card mb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Erinnerung vor Yogastunden</div>
              <div className="text-xs text-yoga-text/50 mt-0.5">Email-Erinnerung an angemeldete Stunden</div>
            </div>
            <select
              className="text-xs border border-yoga-border2 rounded-full px-3 py-1.5 text-yoga-text/70 bg-white outline-none focus:border-yoga-text/40 flex-shrink-0"
              value={profile?.notify_session_reminder_hours ?? ''}
              onChange={async e => {
                const v = e.target.value === '' ? null : parseInt(e.target.value, 10)
                setProfile((p: any) => ({ ...p, notify_session_reminder_hours: v }))
                await supabase.from('profiles').update({ notify_session_reminder_hours: v }).eq('id', profile.id)
              }}>
              <option value="">Aus</option>
              <option value="4">4 Std vorher</option>
              <option value="12">12 Std vorher</option>
              <option value="24">24 Std vorher</option>
            </select>
          </div>
        </div>

        <div className="bg-yoga-gray rounded-yoga p-3 mb-4 text-xs text-yoga-text/60 leading-relaxed">
          <i className="ti ti-info-circle mr-1" />
          Wichtige Benachrichtigungen — Stundenabsagen, Kursabbrüche, Ersatztermine, Wartelisten-Nachrücken und Kurs-Uhrzeit-Änderungen — werden immer gesendet, damit du nichts verpasst.
        </div>

        <p className="section-label">Rechtliches</p>
        <div className="card mb-4 p-0 overflow-hidden">
          {rechtliches.map((item, i) => (
            <a key={item.label} href={item.url} target="_blank" rel="noopener noreferrer"
              className={`flex items-center justify-between px-4 py-3 hover:opacity-80 ${i < rechtliches.length - 1 ? 'border-b border-yoga-border' : ''}`}>
              <span className="text-sm">{item.label}</span>
              <i className="ti ti-external-link text-base opacity-40" />
            </a>
          ))}
        </div>

          </>
        )}
        {/* Ende Yogi-vs-Admin Conditional. AGB-Verwaltung ist jetzt im Admin-Block oben. */}

        {/* App-Installieren + Logout für Yogi nur (Admin hat Logout im Mehr-Block oben).
            Sarah-Wunsch 2026-05-23: Mehr-Menü-Reihenfolge sortiert Logout vor Protokoll. */}
        {!isAdmin && (
          <>
            <InstallButton />
            <button onClick={handleLogout} className="btn-secondary mb-3">Ausloggen</button>
          </>
        )}

        {/* Account löschen nur für normale User, nicht für Admin */}
        {!profile?.is_admin && (!showDeleteConfirm ? (
          <button onClick={() => setShowDeleteConfirm(true)}
            className="w-full text-center text-sm text-yoga-red-text py-3 border border-yoga-red-bg rounded-yoga cursor-pointer hover:opacity-80">
            Account löschen
          </button>
        ) : (
          <div className="bg-yoga-red-bg border border-yoga-red-text/20 rounded-yoga p-4">
            <p className="text-sm font-bold text-yoga-red-text mb-2">Account endgültig löschen?</p>
            <p className="text-sm text-yoga-red-text/80 leading-relaxed mb-3">
              Alle deine Buchungen werden storniert und deine Plätze freigegeben. Diese Aktion ist nicht rückgängig zu machen.
            </p>
            <p className="text-xs text-yoga-red-text/60 leading-relaxed mb-3">
              Dein Konto wird DSGVO-konform anonymisiert: Name und E-Mail werden entfernt, die anonymisierte Buchungshistorie bleibt aus rechtlichen Gründen erhalten.
            </p>
            <p className="text-sm font-semibold text-yoga-red-text leading-relaxed mb-3">
              Wenn du noch Guthaben hast, kontaktiere Sarah bitte vor dem Löschen für eine Abwicklung — nach dem Löschen kann keine Rückzahlung mehr erfolgen.
            </p>
            <label className="flex items-start gap-3 cursor-pointer mb-4">
              <input type="checkbox" checked={deleteConfirmed}
                onChange={e => setDeleteConfirmed(e.target.checked)}
                className="mt-0.5 flex-shrink-0 w-5 h-5" />
              <span className="text-sm text-yoga-red-text leading-relaxed">
                Ich verstehe, dass ich danach nicht mehr in meine Kurse zurückkehren kann.
              </span>
            </label>
            <div className="flex gap-2">
              <button onClick={handleDeleteAccount} disabled={!deleteConfirmed}
                className={`flex-1 text-sm font-bold py-2.5 rounded-yoga border-0 cursor-pointer
                  ${deleteConfirmed ? 'bg-yoga-red-text text-white' : 'bg-yoga-red-bg text-yoga-red-text/40 cursor-not-allowed'}`}>
                Ja, Account löschen
              </button>
              <button onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmed(false) }}
                className="flex-1 text-sm py-2.5 rounded-yoga border-0 cursor-pointer bg-yoga-gray text-yoga-text">
                Abbrechen
              </button>
            </div>
          </div>
        ))}
      </div>
      <BottomNav isAdmin={profile?.is_admin} />
      {/* Toast: "Profil gespeichert" — Sarah-Wunsch 2026-05-25 */}
      {savedToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-yoga-green-text text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg animate-fade-in pointer-events-none">
          <i className="ti ti-check mr-1" /> Profil gespeichert
        </div>
      )}
    </div>
  )
}
