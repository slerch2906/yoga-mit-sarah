'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/auth'
import { fullLogout } from '@/lib/logout'
import { getCurrentAgbVersion, type AgbVersion } from '@/lib/agb-version'
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setShowGuide(false)}>
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
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  async function handleSave(field: string) {
    const user = await getCurrentUser()
    if (!user) return
    if (field === 'email') {
      await supabase.auth.updateUser({ email: editValue })
      setUserEmail(editValue)
    } else {
      await supabase.from('profiles').update({ [field]: editValue }).eq('id', user.id)
    }
    setProfile((prev: any) => ({ ...prev, [field]: editValue }))
    setEditing(null)
  }

  async function handleLogout() {
    await fullLogout()
  }

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)
  const [editingEmergency, setEditingEmergency] = useState(false)
  const [emergencyForm, setEmergencyForm] = useState({ name: '', phone: '' })
  // Sarah-Wunsch 2026-05-23: Admin-AGB-Verwaltung
  const [currentAgb, setCurrentAgb] = useState<AgbVersion | null>(null)
  const [showAgbForm, setShowAgbForm] = useState(false)
  const [agbLabel, setAgbLabel] = useState('')
  const [agbChangelog, setAgbChangelog] = useState('')
  const [pushingAgb, setPushingAgb] = useState(false)

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

    // 3) Warteliste + offene Buchungen entfernen
    await supabase.from('waitlist').delete().eq('user_id', user.id)

    // 3b) Audit-Log Einträge anonymisieren (DSGVO – PII aus details JSONB entfernen)
    await supabase.rpc('anonymize_user_audit_logs', { target_user_id: user.id }).catch(() => {})

    // 4) Admin informieren (inkl. Drive-Hinweis)
    await supabase.from('admin_notifications').insert({
      type: 'account_deleted_dsgvo',
      message: `DSGVO: ${fullName} (${email}) hat seinen Account gelöscht. Bitte PDF im Google Drive manuell löschen.`,
      details: { user_id: user.id, email, full_name: fullName }
    })

    // 5) Email an Admin
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` },
      body: JSON.stringify({ type: 'admin_dsgvo_deletion', data: { fullName, email } })
    }).catch(() => {})

    // 6) Auth User löschen + sofort ausloggen
    // Erst lokal ausloggen (Session löschen), dann Auth-User löschen
    await supabase.auth.signOut({ scope: 'global' }).catch(() => {})
    localStorage.clear()
    sessionStorage.clear()

    // Auth-User asynchron löschen (muss nach signOut passieren)
    fetch('/api/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id })
    }).catch(e => console.error('Delete account:', e))

    // Sofort zur Login-Seite, keine Rückkehr möglich
    window.location.replace('/login')
  }

  const totalFreeCredits = credits.reduce((sum, c) => sum + Math.max(0, c.total - c.used), 0)
  const firstExpiry = [...credits].sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())[0]

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>

  const fields = [
    { key: 'first_name', label: 'Vorname',  value: profile?.first_name },
    { key: 'last_name',  label: 'Nachname', value: profile?.last_name },
    { key: 'email',      label: 'E-Mail',   value: userEmail || profile?.email },
  ]

  const rechtliches = [
    { label: 'Datenschutzerklärung', url: 'https://yogamitsarah.me/privacy-policy/' },
    { label: 'Impressum',            url: 'https://www.yogamitsarah.me/impressum' },
    { label: 'AGB',                  url: 'https://www.yogamitsarah.me/agb' },
  ]

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Mein Profil" isAdmin={profile?.is_admin} />
      <div className="px-4 py-4">
        {profile?.is_admin && (
          <button onClick={() => router.push('/admin/dashboard')}
            className="flex items-center gap-1 text-sm text-yoga-text/60 mb-4 hover:opacity-80 md:flex hidden">
            <i className="ti ti-arrow-left" /> Zurück zum Dashboard
          </button>
        )}
        <p className="section-label">Meine Daten</p>
        <div className="card mb-4 p-0 overflow-hidden">
          {fields.map((f, i) => (
            <div key={f.key} className={`px-4 py-3 ${i < fields.length - 1 ? 'border-b border-yoga-border' : ''}`}>
              {editing === f.key ? (
                <div className="flex items-center gap-2">
                  <input className="field-input flex-1" value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    type={f.key === 'email' ? 'email' : 'text'} />
                  <button onClick={() => handleSave(f.key)}
                    className="text-sm bg-yoga-text text-yoga-bg rounded-full px-3 py-1.5 font-semibold">Speichern</button>
                  <button onClick={() => setEditing(null)} className="text-sm text-yoga-text/50">Abbrechen</button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-yoga-text/50">{f.label}</div>
                    <div className="text-sm font-semibold mt-0.5">{f.value || '—'}</div>
                  </div>
                  <button onClick={() => { setEditing(f.key); setEditValue(f.value || '') }}
                    className="text-xs border border-yoga-border2 rounded-full px-3 py-1 text-yoga-text/60">Ändern</button>
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
            <div>
              {profile?.emergency_name || profile?.emergency_phone ? (
                <div className="mb-3 space-y-1">
                  {profile.emergency_name && <p className="text-sm font-semibold">{profile.emergency_name}</p>}
                  {profile.emergency_phone && <p className="text-sm text-yoga-text/60">{profile.emergency_phone}</p>}
                </div>
              ) : (
                <p className="text-sm text-yoga-text/40 mb-3">Noch kein Notfallkontakt hinterlegt</p>
              )}
              <button onClick={() => {
                setEmergencyForm({ name: profile?.emergency_name || '', phone: profile?.emergency_phone || '' })
                setEditingEmergency(true)
              }} className="btn-secondary text-sm">
                <i className="ti ti-pencil mr-1" />{profile?.emergency_name ? 'Bearbeiten' : 'Hinzufügen'}
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

        {/* Stunden-Erinnerung */}
        <div className="card mb-2">
          <div className="text-sm font-semibold mb-1">Erinnerung vor Yogastunden</div>
          <div className="text-xs text-yoga-text/50 mb-3">Email-Erinnerung an deine angemeldeten Stunden</div>
          <select className="field-input"
            value={profile?.notify_session_reminder_hours ?? ''}
            onChange={async e => {
              const v = e.target.value === '' ? null : parseInt(e.target.value)
              setProfile((p: any) => ({ ...p, notify_session_reminder_hours: v }))
              await supabase.from('profiles').update({ notify_session_reminder_hours: v }).eq('id', profile.id)
            }}>
            <option value="">Aus</option>
            <option value="4">4 Stunden vorher</option>
            <option value="12">12 Stunden vorher</option>
            <option value="24">24 Stunden vorher</option>
          </select>
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

        {/* AGB-Verwaltung (nur für Admin) — Sarah-Wunsch 2026-05-23, Variante A */}
        {profile?.is_admin && (
          <>
            <p className="section-label">AGB-Verwaltung (Admin)</p>
            <div className="card mb-4">
              <p className="text-sm mb-1">
                Aktuelle AGB-Version: <strong>{currentAgb?.label || 'Dezember 2025'}</strong>
              </p>
              <p className="text-xs text-yoga-text/55 mb-3 leading-relaxed">
                Wenn du die AGB auf yogamitsarah.me/agb geändert hast: trag hier die neue Versions-Bezeichnung
                und in einem Satz ein, was sich geändert hat. Beim Pushen müssen alle Yogis beim nächsten
                Login die neue AGB neu bestätigen (mit deinem Changelog).
              </p>

              {!showAgbForm ? (
                <button onClick={() => {
                  setShowAgbForm(true); setAgbLabel(''); setAgbChangelog('')
                }} className="btn-secondary text-sm">
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
                        // Nächste sort_order = max + 1
                        const newOrder = (currentAgb?.sort_order ?? 0) + 1
                        const { data: inserted, error: insErr } = await supabase.from('agb_versions').insert({
                          label: agbLabel.trim(),
                          changelog: agbChangelog.trim(),
                          sort_order: newOrder,
                        }).select('*').single()
                        if (insErr || !inserted) {
                          alert('Fehler beim Speichern: ' + (insErr?.message || ''))
                          setPushingAgb(false); return
                        }
                        // Alle Yogis mit agb_version >= alter-current auf alter-current zurücksetzen
                        // (= sie hatten die alte Version akzeptiert, sollen jetzt die neue bestätigen)
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
          </>
        )}

        {/* App installieren Button */}
        <InstallButton />

        <button onClick={handleLogout} className="btn-secondary mb-3">Ausloggen</button>

        {/* Account löschen nur für normale User, nicht für Admin */}
        {!profile?.is_admin && (!showDeleteConfirm ? (
          <button onClick={() => setShowDeleteConfirm(true)}
            className="w-full text-center text-sm text-yoga-red-text py-3 border border-yoga-red-bg rounded-yoga cursor-pointer hover:opacity-80">
            Account löschen
          </button>
        ) : (
          <div className="bg-yoga-red-bg border border-yoga-red-text/20 rounded-yoga p-4">
            <p className="text-sm font-bold text-yoga-red-text mb-2">Account wirklich löschen?</p>
            <p className="text-sm text-yoga-red-text/80 leading-relaxed mb-3">
              Dein Account wird gemäß DSGVO anonymisiert: Dein Name und deine E-Mail-Adresse werden entfernt.
              Deine Buchungshistorie bleibt anonym erhalten. Credits und offene Buchungen werden storniert.
            </p>
            <label className="flex items-start gap-3 cursor-pointer mb-4">
              <input type="checkbox" checked={deleteConfirmed}
                onChange={e => setDeleteConfirmed(e.target.checked)}
                className="mt-0.5 flex-shrink-0 w-5 h-5" />
              <span className="text-sm text-yoga-red-text leading-relaxed">
                Ich verstehe, dass mein Account DSGVO-konform anonymisiert wird und diese Aktion nicht rückgängig gemacht werden kann.
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
    </div>
  )
}
