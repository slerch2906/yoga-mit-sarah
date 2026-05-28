import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const FROM_EMAIL = 'Mail@yogamitsarah.me'
const FROM_NAME = 'Yoga mit Sarah'
const ADMIN_EMAIL = 'Mail@yogamitsarah.me'
const APP_URL = 'https://kurse.yogamitsarah.me'
const LOGO = 'https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png'
const TZ = 'Europe/Berlin'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-function-secret' }

function checkSecret(req: Request): boolean {
  const secret = Deno.env.get('EDGE_FUNCTION_SECRET')
  if (!secret) return true
  return req.headers.get('x-function-secret') === secret
}

// Welle S1/H7 (Sarah 2026-05-27): zentraler HTML-Escape-Helper gegen Phishing-Injection.
// User-Input (reason, firstName, courseName, etc.) wird OHNE Tags ins Mail-HTML
// gerendert. Whitelist-Approach: nur 5 HTML-Sonderzeichen escapen.
function htmlEscape(input: unknown): string {
  if (input === null || input === undefined) return ''
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}
const esc = htmlEscape

function kursLabel(data: any): string {
  const st = data?.sessionType
  if (st === 'event_free' || st === 'event_paid') return 'Event'
  if (st === 'single' || data?.isSingle === true) return 'Einzelstunde'
  return 'Kurs'
}
function isContainerSession(data: any): boolean {
  const st = data?.sessionType
  return st === 'event_free' || st === 'event_paid' || st === 'single'
}
function isEventSession(data: any): boolean {
  const st = data?.sessionType
  return st === 'event_free' || st === 'event_paid'
}

async function notifyEmailFailed(to: string, subject: string, error: string, status: number) {
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })
    await sb.from('admin_notifications').insert({ type: 'email_failed', message: `Email konnte nicht zugestellt werden an ${to}`, details: { to, subject, error, status }, read: false })
  } catch (e) { console.error('notifyEmailFailed:', e) }
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ok: boolean, status: number}> {
  const apiKey = Deno.env.get('BREVO_API_KEY')
  if (!apiKey) { await notifyEmailFailed(to, subject, 'BREVO_API_KEY fehlt', 0); return { ok: false, status: 0 } }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        headers: { 'X-Mailin-Track-Click': '0', 'X-Mailin-Track-Open': '0' },
      }),
    })
    if (!res.ok) { const e = await res.text().catch(() => ''); await notifyEmailFailed(to, subject, e.substring(0,500), res.status) }
    return { ok: res.ok, status: res.status }
  } catch(e) { await notifyEmailFailed(to, subject, String(e), 0); return { ok: false, status: 0 } }
}

function base(content: string): string {
  // UX-Refresh 2026-05-28 (Sarah): wärmerer Hintergrund, weichere Karte, mehr
  // Luft + Lesbarkeit. Struktur bleibt inline (E-Mail-sicher); die Absatz-
  // Feinabstimmung per <style> ist rein additiv (Fallback = vorheriges Verhalten).
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>.em-body p{margin:0 0 12px;line-height:1.6}.em-body strong{color:#2e2b2a}</style></head><body style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#efeae6;margin:0;padding:24px 14px"><div style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(61,58,57,0.10)"><div style="background:#cfcbca;padding:24px 32px;text-align:center"><img src="${LOGO}" width="56" height="56" style="border-radius:50%;display:block;margin:0 auto 8px" alt=""/><h1 style="color:#3d3a39;font-size:18px;margin:0;font-weight:700;letter-spacing:.3px">Yoga mit Sarah</h1></div><div class="em-body" style="padding:26px 30px;color:#3d3a39;font-size:15px;line-height:1.6">${content}</div><div style="padding:18px 32px;text-align:center;font-size:12px;color:#9b9591;border-top:1px solid #f0eded;line-height:1.6">Sarah Lerch &middot; Fuldaer Str. 7 &middot; 63628 Bad Soden-Salmünster<br><a href="https://www.yogamitsarah.me/agb" style="color:#9b9591">AGB</a> &middot; <a href="https://yogamitsarah.me/privacy-policy/" style="color:#9b9591">Datenschutz</a></div></div></body></html>`
}
function btn(text: string, url: string, color = '#3d3a39'): string {
  // url ist server-controlled (immer aus APP_URL + token), text ist control-string oder escaped.
  return `<p style="text-align:center;margin:20px 0"><a href="${url}" style="display:inline-block;background:${color};color:#fbf9f7;text-decoration:none;padding:14px 30px;border-radius:999px;font-weight:700;font-size:14px;letter-spacing:.2px;box-shadow:0 2px 6px rgba(61,58,57,0.18)">${text}</a></p>`
}
function hl(content: string, bg = '#f5f2f0'): string {
  return `<div style="background:${bg};border-radius:12px;padding:15px 18px;margin:14px 0">${content}</div>`
}
function fmtDate(d: string, t?: string): string {
  const date = new Date(`${d}T12:00:00Z`).toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone: TZ })
  return t ? `${date} um ${t.slice(0,5)} Uhr` : date
}
function fmtDateShort(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('de-DE', { day:'numeric', month:'long', timeZone: TZ })
}
function cancelDeadlineStr(timeStart: string): string {
  const [hStr, mStr] = (timeStart || '00:00').split(':')
  let h = parseInt(hStr, 10) - 3
  const m = parseInt(mStr, 10)
  if (h < 0) h += 24
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
}
function guthabenExpiryStr(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 2)
  return d.toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric', timeZone: TZ })
}
const WD: Record<string,string> = { 'Montag':'Montags','Dienstag':'Dienstags','Mittwoch':'Mittwochs','Donnerstag':'Donnerstags','Freitag':'Freitags','Samstag':'Samstags','Sonntag':'Sonntags' }
const LG = '<p style="font-size:15px;margin-top:20px">Liebe Grüße,<br><strong>Sarah</strong></p>'
const BULK_OPTOUT = '<p style="font-size:11px;color:#999;margin-top:24px;padding-top:12px;border-top:1px solid #f0eded;line-height:1.5;text-align:center">Du erhältst diese Mail weil du Yogi bei Yoga mit Sarah bist.<br>Wenn du keine solchen Info-Mails mehr erhalten möchtest, schreib mir kurz: <a href="mailto:Mail@yogamitsarah.me" style="color:#999">Mail@yogamitsarah.me</a></p>'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!checkSecret(req)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  try {
    const { type, data } = await req.json()
    let subject = '', html = '', to = data?.email || ADMIN_EMAIL
    const KL = kursLabel(data)
    // Welle S1/H7: pre-escape aller User-Input-Strings
    const fn = esc(data?.firstName)
    const cn = esc(data?.courseName)
    const reason = esc(data?.reason)
    const yogiName = esc(data?.yogiName)
    const yogiEmail = esc(data?.yogiEmail)
    const fullName = esc(data?.fullName)
    switch (type) {
      case 'welcome':
        subject = `Willkommen bei Yoga mit Sarah!`
        html = base(`<p style="font-size:15px">Hallo ${fn}!</p><p style="font-size:15px">Schön, dass du dabei bist! 💛</p>${data.courseName ? hl(`<p style="margin:0;font-size:15px">Du bist direkt in den Kurs <strong>${cn}</strong> eingebucht.</p>`,'#e8ede6') : ''}${btn('Zur App',APP_URL)}<p style="font-size:15px">Ich freue mich, dich bald auf der Matte zu sehen!</p>${LG}`)
        break
      case 'invitation_sent':
        subject = `Einladung zur Yoga-App – Yoga mit Sarah`
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">ich lade dich herzlich ein, meiner Yoga-App beizutreten!</p><p style="font-size:15px">Die Stundenverwaltung läuft ausschließlich über die App – bitte registriere dich, um deine Stunden planen und buchen zu können.</p>${data.courseName ? hl(`<p style="margin:0;font-size:15px;color:#3a5a30">Du wirst direkt in den Kurs <strong>${cn}</strong> eingebucht.</p>`,'#e8ede6') : ''}${btn('Jetzt registrieren',data.inviteLink)}<p style="font-size:13px;color:#999;text-align:center">Der Link ist 14 Tage gültig.</p>${LG}`)
        break
      case 'invitation_reminder':
        subject = `Erinnerung: Deine Einladung zur Yoga-App`
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">ich wollte kurz an deine Einladung erinnern.</p><p style="font-size:15px">Die Stundenverwaltung läuft ausschließlich über die App – bitte registriere dich, um deine Stunden planen und buchen zu können.</p>${data.courseName ? hl(`<p style="margin:0;font-size:15px;color:#3a5a30">Du wirst direkt in den Kurs <strong>${cn}</strong> eingebucht.</p>`,'#e8ede6') : ''}${btn('Jetzt registrieren',data.inviteLink)}<p style="font-size:13px;color:#999;text-align:center">Der Einladungslink ist noch gültig.</p>${LG}`)
        break
      case 'admin_bulk_announcement': {
        // Welle S1/H7: bodyHtml war bereits HTML-escaped. Subject jetzt auch.
        const bodyHtml = String(data.body || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
        subject = String(data.subject || '').slice(0, 200)
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><div style="font-size:15px;line-height:1.55">${bodyHtml}</div>${btn('Zur App',APP_URL)}${LG}${BULK_OPTOUT}`)
        break
      }
      case 'yogi_enrolled_by_admin': {
        const total = data.totalUnits
        const remaining = data.remainingUnits ?? data.totalUnits
        const midCourse = total && remaining && remaining < total
        subject = `Du wurdest in den Kurs ${data.courseName} eingetragen`
        const wd = esc(WD[data.weekday]||data.weekday)
        const ts = esc(data.timeStart?.slice(0,5))
        const dm = esc(data.durationMin)
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">ich habe dich in einen Kurs eingetragen.</p>${hl(`<p style="margin:4px 0;font-size:15px;font-weight:bold">Kurs: ${cn}</p><p style="margin:8px 0 4px;font-size:14px">📅 ${wd} um ${ts} Uhr</p><p style="margin:4px 0;font-size:14px">${dm} Minuten pro Einheit</p>`)}${hl(`<p style="margin:0 0 10px;font-size:14px;font-weight:bold">Dein Kursumfang</p>${total ? `<p style="margin:4px 0;font-size:14px">Kurs hat insgesamt <strong>${esc(total)} Einheiten</strong>${data.dateStart ? ` (Kursbeginn: ${fmtDate(data.dateStart)})` : ''}.</p>` : ''}${midCourse ? `<p style="margin:8px 0 4px;font-size:14px;color:#6b2a2a">Du steigst <strong>mitten im Kurs</strong> ein${data.firstSessionDate ? ` (deine erste Stunde: ${fmtDate(data.firstSessionDate)})` : ''}.</p><p style="margin:4px 0;font-size:14px;color:#3a5a30">✅ Für dich verbleiben <strong>${esc(remaining)} Stunden</strong> — du hast dafür <strong>${esc(remaining)} Credits</strong> in deinem Profil.</p>` : `<p style="margin:8px 0;font-size:14px;color:#3a5a30">✅ Du nimmst an allen <strong>${esc(remaining)} Stunden</strong> teil — du hast dafür <strong>${esc(remaining)} Credits</strong> in deinem Profil.</p>`}`,'#e8ede6')}${hl(`<p style="margin:0 0 8px;font-size:14px;font-weight:bold">Wichtige Regeln</p><p style="margin:4px 0;font-size:13px">✅ Abmeldung einzelner Stunden: kostenlos bis 3 Stunden vorher</p><p style="margin:4px 0;font-size:13px">✅ Nachholen dieser Stunden: bis 8 Tage nach Kursende möglich</p><p style="margin:4px 0;font-size:13px">✅ Vorholen von Stunden max. 10 Tage im Voraus</p><p style="margin:4px 0;font-size:13px">✅ Rücktritt vom gesamten Kurs: kostenlos bis 14 Tage vor Kursbeginn — danach Gebühr (30 € bis 7 Tage vorher, ab 6 Tagen volle Gebühr). Ersatzteilnehmer jederzeit möglich.</p>`,'#f5f2f0')}${btn('Zu meinen Buchungen',APP_URL+'/meine')}<p style="font-size:15px">Ich freue mich, dich bald auf der Matte zu begrüßen!</p>${LG}`)
        break
      }
      case 'booking_confirmed': {
        const isPaidEvent = data.sessionType === 'event_paid'
        const isFreeEvent = data.sessionType === 'event_free'
        const isSingle = data.sessionType === 'single' || (data.isSingle === true && !isPaidEvent && !isFreeEvent)
        subject = isPaidEvent ? `Anmeldung bestätigt: ${data.courseName}` : isFreeEvent ? `Anmeldung bestätigt: ${data.courseName}` : `Buchung bestätigt: ${data.courseName}`
        const dlStr = cancelDeadlineStr(data.timeStart)
        let regelBlock = ''
        if (isPaidEvent) {
          regelBlock = hl(`<p style="margin:0 0 8px;font-size:14px;font-weight:bold">Wichtige Regeln</p><p style="margin:4px 0;font-size:13px">✅ Verbindliche Anmeldung — die Bezahlung läuft direkt mit Sarah (PayPal oder Bar).</p><p style="margin:4px 0;font-size:13px">✅ <strong>Stornofrist: 7 Tage</strong> vor dem Event. Bis dahin kannst du dich kostenfrei abmelden.</p><p style="margin:4px 0;font-size:13px">⚠️ Bei späterer Abmeldung fällt die <strong>volle Gebühr</strong> an.</p><p style="margin:4px 0;font-size:13px">👯 Du kannst aber gerne einen <strong>Ersatzkandidaten</strong> benennen — wende dich dafür direkt an Sarah.</p>`,'#f5f2f0')
        } else if (isFreeEvent) {
          regelBlock = hl(`<p style="margin:0 0 8px;font-size:14px;font-weight:bold">Gut zu wissen</p><p style="margin:4px 0;font-size:13px">✅ Das Event ist kostenlos — einfach kommen und mitmachen.</p><p style="margin:4px 0;font-size:13px">✅ Du kannst Dich jederzeit wieder abmelden.</p>`,'#e8ede6')
        } else if (isSingle) {
          regelBlock = hl(`<p style="margin:0 0 8px;font-size:14px;font-weight:bold">Wichtige Regeln</p><p style="margin:4px 0;font-size:13px">✅ Kostenlose Abmeldung bis <strong>${esc(dlStr)} Uhr</strong> (3 Stunden vor Beginn).</p><p style="margin:4px 0;font-size:13px">⚠️ Danach verfällt der Credit.</p>`,'#f5f2f0')
        }
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">deine Anmeldung ist bestätigt!</p>${hl(`<p style="margin:4px 0;font-size:14px">📅 <strong>${fmtDate(data.date,data.timeStart)}</strong></p><p style="margin:4px 0;font-size:14px">${KL}: ${cn} · ${esc(data.durationMin)} Min.</p>`)}${regelBlock}${btn('Meine Buchungen',APP_URL+'/meine')}${LG}`)
        break
      }
      case 'booking_cancelled': {
        const isPaidEvent = data.sessionType === 'event_paid'
        const isFreeEvent = data.sessionType === 'event_free'
        const isEvent = isPaidEvent || isFreeEvent
        subject = `Abmeldung bestätigt: ${data.courseName}`
        let infoLine = ''
        if (isPaidEvent) infoLine = '✅ Deine Abmeldung war rechtzeitig (vor der 7-Tage-Frist) und somit kostenfrei.'
        else if (isFreeEvent) infoLine = '✅ Deine Abmeldung ist bestätigt — die Teilnahme war kostenlos, es entstehen dir keine Kosten. Vielleicht sehen wir uns beim nächsten Event!'
        else infoLine = data.creditReturned ? '✅ Du bekommst einen Credit gutgeschrieben.' : '❌ Credit nicht zurückgebucht (unter 3h).'
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">deine Abmeldung wurde bestätigt.</p>${hl(`<p style="margin:4px 0;font-size:14px">📅 ${fmtDate(data.date,data.timeStart)}</p><p style="margin:4px 0;font-size:14px">${KL}: ${cn}</p><p style="margin:4px 0;font-size:14px">${infoLine}</p>`)}${(isEvent || data.creditReturned) ? btn('Zur App',APP_URL+'/meine') : btn('Zur App',APP_URL)}${LG}`)
        break
      }
      case 'waitlist_joined': {
        const isPaidEvent = data.sessionType === 'event_paid'
        const isFreeEvent = data.sessionType === 'event_free'
        const unsubscribeUrl = data.unsubscribeToken ? `${APP_URL}/warteliste/austragen?token=${encodeURIComponent(data.unsubscribeToken)}` : `${APP_URL}/meine`
        subject = `Warteliste: ${data.courseName}`
        let infoBlock = ''
        if (isFreeEvent) {
          infoBlock = `<p style="font-size:15px">Du stehst jetzt auf der Warteliste für mein kostenloses Event <strong>„${cn}"</strong>.</p>${hl(`<p style="margin:4px 0;font-size:14px">📅 ${fmtDate(data.date,data.timeStart)}</p><p style="margin:4px 0;font-size:14px">👥 Position: <strong>${esc(data.position)}</strong></p>`)}<p style="font-size:14px"><strong>So funktioniert's:</strong> Wenn ein Platz frei wird, rutschst Du bis 90 Minuten davor automatisch nach und wirst per E-Mail informiert. In den letzten 90 Minuten gilt: wer zuerst zusagt, bekommt den Platz.</p><p style="font-size:14px">Du kannst Dich jederzeit kostenlos wieder austragen.</p>`
        } else if (isPaidEvent) {
          infoBlock = `<p style="font-size:15px">Du stehst jetzt auf der Warteliste für <strong>„${cn}"</strong>.</p>${hl(`<p style="margin:4px 0;font-size:14px">📅 ${fmtDate(data.date,data.timeStart)}</p><p style="margin:4px 0;font-size:14px">👥 Position: <strong>${esc(data.position)}</strong></p>`)}${hl(`<p style="margin:0 0 8px;font-size:14px;font-weight:bold">Wichtig — verbindliche Buchung:</p><p style="margin:4px 0;font-size:13px">Wenn ein Platz frei wird, rückst Du automatisch nach. Damit wird deine Anmeldung <strong>verbindlich gebucht</strong>.</p><p style="margin:4px 0;font-size:13px">⚠️ Beachte die Stornofrist — nur bis <strong>7 Tage</strong> vorher kostenfrei. Danach fällt die volle Gebühr an, außer du ernennst einen Ersatzteilnehmer.</p>`,'#fff3d6')}`
        } else {
          infoBlock = `<p style="font-size:15px">du stehst auf der Warteliste.</p>${hl(`<p style="margin:4px 0;font-size:14px">📅 ${fmtDate(data.date,data.timeStart)}</p><p style="margin:4px 0;font-size:14px">${KL}: ${cn}</p><p style="margin:4px 0;font-size:14px">👥 Position: <strong>${esc(data.position)}</strong></p>`)}<p style="font-size:15px">Du wirst automatisch eingebucht, sobald ein Platz frei wird. Du hast dann <strong>1 Stunde Zeit</strong>, dich kostenlos abzumelden.</p><p style="font-size:13px;color:#666">Wird ein Platz weniger als 90 Minuten vor Stundenbeginn frei, bekommen alle Wartelisten-Yogis eine Auswahl-Mail — wer zuerst klickt, kriegt den Platz.</p>`
        }
        html = base(`<p style="font-size:15px">Hallo ${fn},</p>${infoBlock}${btn('Zur Warteliste',APP_URL+'/warteliste')}${btn('Wieder austragen',unsubscribeUrl,'#6b2a2a')}${LG}`)
        break
      }
      case 'waitlist_promoted': {
        // Sarah-Fix 2026-05-28: Event-spezifische Texte. Label kommt via KL
        // ("Event:" statt "Kurs:"). Stornoregeln je nach Typ — die "1 Stunde
        // kostenlos abmelden"-Regel gilt NUR für Kursstunden/Einzelstunden.
        const isPaidEvent = data.sessionType === 'event_paid'
        const isFreeEvent = data.sessionType === 'event_free'
        subject = `Du bist dabei: ${data.courseName}`
        let regelBlock = ''
        if (isPaidEvent) {
          regelBlock = hl(`<p style="margin:0 0 8px;font-size:14px;font-weight:bold">Wichtig — verbindliche Buchung:</p><p style="margin:4px 0;font-size:13px">✅ Du bist jetzt verbindlich gebucht. Die Bezahlung läuft direkt mit Sarah (PayPal oder Bar).</p><p style="margin:4px 0;font-size:13px">✅ <strong>Stornofrist: 7 Tage</strong> vor dem Event — bis dahin kannst du dich kostenfrei abmelden.</p><p style="margin:4px 0;font-size:13px">⚠️ Bei späterer Abmeldung fällt die <strong>volle Gebühr</strong> an.</p><p style="margin:4px 0;font-size:13px">👯 Du kannst aber gerne einen <strong>Ersatzkandidaten</strong> benennen — wende dich dafür direkt an Sarah.</p>`,'#fff3d6')
        } else if (isFreeEvent) {
          regelBlock = hl(`<p style="margin:0 0 8px;font-size:14px;font-weight:bold">Gut zu wissen</p><p style="margin:4px 0;font-size:13px">✅ Das Event ist kostenlos — einfach kommen und mitmachen.</p><p style="margin:4px 0;font-size:13px">✅ Du kannst Dich jederzeit wieder abmelden.</p>`,'#e8ede6')
        } else {
          regelBlock = `<p style="font-size:15px">Du hast <strong>1 Stunde Zeit</strong>, dich kostenlos abzumelden.</p>`
        }
        // Sarah-Regel 2026-05-28: Bei Kurs-/Einzelstunden zusätzlich einen direkten
        // "Wieder absagen"-Button — fuer den Fall, dass man versehentlich
        // nachgerueckt ist. Fuehrt auf die Stunden-Seite, wo die 60-Min-Gnadenfrist
        // greift (kostenlose Abmeldung, Credit zurueck).
        const undoBtn = (!isPaidEvent && !isFreeEvent && data.sessionId)
          ? btn('Versehentlich nachgerückt? Wieder absagen', APP_URL+'/kurse/'+encodeURIComponent(data.sessionId), '#6b2a2a')
          : ''
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">🎉 Ein Platz ist frei – du bist automatisch eingebucht!</p>${hl(`<p style="margin:4px 0;font-size:14px">📅 <strong>${fmtDate(data.date,data.timeStart)}</strong></p><p style="margin:4px 0;font-size:14px">${KL}: ${cn}</p>`)}${regelBlock}${btn('Meine Buchungen',APP_URL+'/meine')}${undoBtn}${LG}`)
        break
      }
      case 'waitlist_offer_late': {
        subject = `Letzte Chance: ${data.courseName} in Kürze`
        const acceptUrl = `${APP_URL}/warteliste/angebot/${encodeURIComponent(data.offerToken || '')}`
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">ein Platz wurde gerade frei — aber es ist weniger als 90 Minuten vor Stundenbeginn.</p>${hl(`<p style="margin:4px 0;font-size:14px">📅 <strong>${fmtDate(data.date,data.timeStart)}</strong></p><p style="margin:4px 0;font-size:14px">${KL}: ${cn}</p>`,'#fff3d6')}<p style="font-size:15px"><strong>Alle Wartelisten-Yogis bekommen diese Mail — wer zuerst klickt, bekommt den Platz.</strong></p>${btn('Ja, ich nehme den Platz',acceptUrl,'#3a5a30')}<p style="font-size:13px;color:#666">Wenn du nicht reagierst, passiert nichts — du bleibst auf der Warteliste und bekommst erneut eine Nachricht, falls wieder ein Platz frei wird.</p>${LG}`)
        break
      }
      case 'waitlist_removed_credit_used_elsewhere':
        subject = `Warteliste entfernt: ${data.courseName}`
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">deine Wartelisten-Position (für die unten stehende Einheit) wurde entfernt, weil dein Credit anderweitig verwendet wurde:</p>${hl(`<p style="margin:4px 0;font-size:14px">📅 ${fmtDate(data.date,data.timeStart)}</p><p style="margin:4px 0;font-size:14px">${KL}: ${cn}</p>`,'#f0e6e6')}<p style="font-size:15px">Falls du nochmal versuchen willst auf die Warteliste zu kommen – du brauchst dafür einen freien Credit. Du kannst dich aber jederzeit benachrichtigen lassen, wenn ein Platz frei wird.</p>${btn('Zur App',APP_URL+'/meine')}${LG}`)
        break
      case 'notify_place_free':
        subject = `Platz frei: ${data.courseName}`
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">🎉 Ein Platz ist frei geworden!</p>${hl(`<p style="margin:4px 0;font-size:14px">📅 <strong>${fmtDate(data.date,data.timeStart)}</strong></p><p style="margin:4px 0;font-size:14px">${KL}: ${cn}</p>`)}${btn('Jetzt buchen',APP_URL+'/kurse/'+encodeURIComponent(data.sessionId||''))}${LG}`)
        break
      case 'session_reminder':
        subject = `Erinnerung: ${data.courseName} in ${esc(data.hoursBefore)} Std.`
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">kleine Erinnerung an deine Yogastunde:</p>${hl(`<p style="margin:4px 0;font-size:14px">📅 <strong>${fmtDate(data.date,data.timeStart)}</strong></p><p style="margin:4px 0;font-size:14px">${KL}: ${cn} · ${esc(data.durationMin)} Min.</p>`,'#e8ede6')}<p style="font-size:15px">Falls du nicht kommen kannst, melde dich über die App ab.</p>${btn('Zur Stunde',APP_URL+'/meine')}${LG}`)
        break
      case 'session_cancelled': {
        const isContainer = isContainerSession(data)
        const isEvent = isEventSession(data)
        const isPaidEvent = data.sessionType === 'event_paid'
        const isFreeEvent = data.sessionType === 'event_free'
        const subjNoun = isEvent ? 'Event' : isContainer ? 'Stunde' : 'Kursstunde'
        subject = `${subjNoun} abgesagt: ${data.courseName}`
        const hasRep = !!data.replacementDate && !isContainer
        let afterBlock = ''
        if (hasRep) afterBlock = `${hl(`<p style="margin:0 0 8px;font-size:14px;font-weight:bold;color:#3a5a30">Ersatztermin: ${fmtDate(data.replacementDate, data.replacementTime)}</p><p style="margin:0;font-size:13px">Dein Credit wird automatisch auf den Ersatztermin eingebucht.</p>`,'#e8ede6')}${btn('Meine Buchungen',APP_URL+'/meine')}`
        else if (isFreeEvent) afterBlock = `<p style="font-size:15px">Da das Event kostenlos war, ist keine weitere Aktion nötig. Ich melde mich, falls es einen Nachhol-Termin gibt.</p>`
        else if (isPaidEvent) afterBlock = `<p style="font-size:15px">Eine bereits geleistete Bezahlung erstatte ich dir extern (PayPal / Überweisung). Ich melde mich persönlich bei dir.</p>`
        else if (isContainer) afterBlock = `<p style="font-size:15px">✅ Dein Credit wurde dir automatisch gutgeschrieben.</p>`
        else afterBlock = `<p style="font-size:15px">✅ Dein Credit wird dir automatisch gutgeschrieben.</p><p style="font-size:15px">Sobald eine Ersatzstunde eingetragen wird, wirst du automatisch eingebucht – außer du hast den gutgeschriebenen Credit bereits in einer anderen Stunde verwendet.</p>`
        // Welle S1/H7: reason war XSS-Vektor — jetzt escape.
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">leider muss ich ${isEvent ? 'dieses Event' : 'diese Stunde'} absagen:</p>${hl(`<p style="margin:4px 0;font-size:14px">📅 <strong>${fmtDate(data.date,data.timeStart)}</strong></p><p style="margin:4px 0;font-size:14px">${KL}: ${cn}</p>${data.reason?`<p style="margin:4px 0;font-size:14px">💬 ${reason}</p>`:''}`,'#f0e6e6')}${afterBlock}${LG}`)
        break
      }
      case 'session_added': {
        const hasOrig = !!data.originalDate
        subject = hasOrig ? `Ersatztermin für deine abgesagte Stunde am ${fmtDateShort(data.originalDate)} – ${data.courseName}` : `Neuer Ersatztermin: ${data.courseName}`
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">für deine abgesagte Stunde gibt es einen Ersatztermin.</p>${hasOrig ? hl(`<p style="margin:0 0 4px;font-size:13px;font-weight:bold;color:#6b2a2a">Ursprüngliche Stunde (abgesagt):</p><p style="margin:4px 0;font-size:14px">📅 ${fmtDate(data.originalDate, data.originalTime)}</p>`, '#f0e6e6') : ''}${hl(`<p style="margin:0 0 4px;font-size:13px;font-weight:bold;color:#3a5a30">Neuer Ersatztermin:</p><p style="margin:4px 0;font-size:14px">📅 <strong>${fmtDate(data.date,data.timeStart)}</strong></p><p style="margin:4px 0;font-size:14px">${KL}: ${cn}</p>`,'#e8ede6')}<p style="font-size:15px">✅ Du wurdest automatisch eingetragen und dein Credit der ursprünglichen Stunde wurde dafür verwendet.</p>${btn('Meine Stunden',APP_URL+'/meine')}${LG}`)
        break
      }
      case 'course_time_changed':
        subject = `Uhrzeitänderung: ${data.courseName}`
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">die Uhrzeit für deine Stunden hat sich geändert:</p>${hl(`<p style="margin:4px 0;font-size:14px">Kurs: <strong>${cn}</strong></p><p style="margin:8px 0 4px;font-size:14px">Bisher: <strong>${esc(data.oldTime?.slice(0,5))} Uhr</strong></p><p style="margin:4px 0;font-size:14px;color:#3a5a30">Neu: <strong>${esc(data.newTime?.slice(0,5))} Uhr</strong></p>`)}${btn('Meine Stunden',APP_URL+'/meine')}${LG}`)
        break
      case 'course_cancelled': {
        subject = `Kurs abgesagt: ${data.courseName}`
        const isAllR = data.refundMode === 'all_refund'
        // Sarah-Wunsch 2026-05-28: Hinweis, dass mit den Kurs-Credits gebuchte
        // Vorhol-/Nachholstunden bei Erstattung/Guthaben ebenfalls entfallen.
        const vorholHinweis = hl(`<p style="margin:0;font-size:13px;color:#6b2a2a">⚠️ Alle deine zukünftigen Vorhol- oder Nachholstunden, die mit den Credits dieses Kurses gebucht wurden, werden ebenfalls gelöscht, da du eine ${isAllR ? 'Erstattung' : 'Erstattung oder ein Guthaben'} bekommst.</p>`,'#f0e6e6')
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">leider muss ich den folgenden Kurs absagen:</p>${hl(`<p style="margin:4px 0;font-size:15px;font-weight:bold">Kurs: ${cn}</p>${data.reason?`<p style="margin:8px 0 0;font-size:14px">💬 ${reason}</p>`:''}<p style="margin:8px 0 0;font-size:14px">💡 ${esc(data.remainingSessions)} Stunden entfallen</p>`,'#f0e6e6')}${vorholHinweis}${isAllR?`<p style="font-size:15px">Für die <strong>${esc(data.remainingSessions)} noch nicht stattgefundenen Kurseinheiten</strong> erhältst du eine anteilige Erstattung des gezahlten Kurspreises. Ich melde mich bei dir.</p>`:`<p style="font-size:15px">Für die <strong>${esc(data.remainingSessions)} noch nicht stattgefundenen Kurseinheiten</strong> hast du die Wahl zwischen einer anteiligen Erstattung oder Kurs-Guthaben (<strong>2 Jahre gültig</strong>).</p>${hl(`<p style="margin:0;font-size:13px">💡 <strong>Du siehst die ${esc(data.remainingSessions)} Credits ab sofort als Guthaben in deiner App-Übersicht.</strong> Bei der Wahl <strong>„Anteilige Erstattung"</strong> werden sie wieder entfernt.</p>`,'#f5f2f0')}<p style="font-size:15px">Du hast <strong>7 Tage</strong> Zeit:</p><div style="margin:20px 0">${btn('Guthaben behalten - 2 Jahre gültig',data.guthabenUrl,'#3a5a30')}${btn('Anteilige Erstattung',data.guthabenUrl+'?wahl=erstattung','#6b2a2a')}</div>${hl(`<p style="margin:0;font-size:13px">✨ Ich freue mich besonders, wenn du das Guthaben wählst — dann sehen wir uns im nächsten Kurs wieder. Das Guthaben ist 2 Jahre gültig und falls du es bis dahin nicht eingelöst hast (z. B. weil kein passender Kurs zustande kommt), wird dir der Geldbetrag automatisch ausgezahlt — du verlierst in keinem Fall etwas.</p>`,'#e8ede6')}<p style="font-size:12px;color:#999;text-align:center">Ohne Rückmeldung wird dir automatisch der Geldbetrag erstattet. Sarah meldet sich dann persönlich bei dir wegen der Überweisung.</p>`}${LG}`)
        break
      }
      case 'admin_course_cancelled_summary': {
        to = ADMIN_EMAIL
        subject = `Kurs abgebrochen: ${data.courseName}`
        const yogiRows = (data.yogis || []).map((y: any) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #f0eded;font-size:14px">${esc(y.firstName)} ${esc(y.lastName)}</td><td style="padding:6px 8px;border-bottom:1px solid #f0eded;font-size:14px">${esc(y.email)}</td></tr>`).join('')
        html = base(`<p style="font-size:15px">Hallo Sarah,</p><p style="font-size:15px">du hast folgenden Kurs abgebrochen:</p>${hl(`<p style="margin:4px 0;font-size:15px;font-weight:bold">Kurs: ${cn}</p>${data.reason?`<p style="margin:8px 0 0;font-size:14px">💬 ${reason}</p>`:''}<p style="margin:8px 0 0;font-size:14px">💡 ${esc(data.remainingSessions)} Stunden entfallen</p>`,'#f0e6e6')}<p style="font-size:15px;font-weight:bold;margin-top:20px">Betroffene Yogis (${(data.yogis||[]).length}):</p><table style="width:100%;border-collapse:collapse;margin-top:8px"><thead><tr style="background:#f5f2f0"><th style="padding:8px;text-align:left;font-size:13px;font-weight:600">Name</th><th style="padding:8px;text-align:left;font-size:13px;font-weight:600">E-Mail</th></tr></thead><tbody>${yogiRows}</tbody></table>${btn('Admin-Bereich',APP_URL+'/admin/kurse')}`)
        break
      }
      case 'admin_yogi_choice': {
        to = ADMIN_EMAIL
        const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })
        const { data: profile } = await sb.from('profiles').select('first_name, last_name, email').eq('id', data.userId).maybeSingle()
        const yName = profile ? esc(`${profile.first_name||''} ${profile.last_name||''}`.trim()) : 'Unbekannt'
        const yEmail = esc(profile?.email || '')
        const isGuthaben = data.choice === 'guthaben'
        const choiceLabel = isGuthaben ? 'Guthaben behalten' : 'Geld zurück'
        subject = `Kursabbruch-Entscheidung: ${profile ? `${profile.first_name||''} ${profile.last_name||''}`.trim() : 'Unbekannt'}`
        html = base(`<p style="font-size:15px">Hallo Sarah,</p><p style="font-size:15px">ein Yogi hat seine Entscheidung zum Kursabbruch getroffen:</p>${hl(`<p style="margin:4px 0;font-size:15px;font-weight:bold">${choiceLabel}</p><p style="margin:10px 0 4px;font-size:14px"><strong>${yName}</strong></p><p style="margin:4px 0;font-size:14px">${yEmail}</p><p style="margin:8px 0 0;font-size:14px">Kurs: ${cn}</p><p style="margin:4px 0;font-size:14px">${esc(data.remainingSessions)} Einheiten</p>`,isGuthaben?'#e8ede6':'#f0e6e6')}${isGuthaben?'<p style="font-size:15px">✅ Credits wurden automatisch gutgeschrieben.</p>':'<p style="font-size:15px">Bitte kläre die Erstattung direkt mit dem Yogi.</p>'}${btn('Admin-Bereich',APP_URL+'/admin/kurse')}`)
        break
      }
      case 'yogi_course_cancel_choice': {
        const isGuthaben = data.choice === 'guthaben'
        const refund = data.refundCredits ?? 0
        const newPaid = data.newPaidCredits ?? data.guthabenCredits ?? 0
        const verrechnet = Math.max(0, refund - newPaid)
        subject = isGuthaben ? `Guthaben gutgeschrieben: ${data.courseName}` : `Erstattungsanfrage bestätigt: ${data.courseName}`
        if (isGuthaben) {
          const expiryStr = guthabenExpiryStr()
          html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">danke für deine Rückmeldung — ich habe dein Guthaben gespeichert.</p>${hl(`<p style="margin:4px 0;font-size:15px;font-weight:bold">Guthaben behalten</p><p style="margin:8px 0 0;font-size:14px">Kurs: ${cn}</p><p style="margin:4px 0;font-size:14px">💡 ${esc(refund)} Stunden betroffen</p>${newPaid > 0 ? `<p style="margin:8px 0 0;font-size:14px;color:#3a5a30">✅ <strong>${esc(newPaid)} Credits</strong> als Guthaben gutgeschrieben.</p>` : ''}${verrechnet > 0 ? `<p style="margin:4px 0;font-size:14px;color:#3a5a30">✅ Vorher verrechnetes Guthaben (${esc(verrechnet)} Credits) wieder freigegeben.</p>` : ''}`,'#e8ede6')}${hl(`<p style="margin:0;font-size:13px">Hinweis: Das Guthaben ist 2 Jahre gültig (bis <strong>${esc(expiryStr)}</strong>). Falls du es bis dahin nicht eingelöst hast — z. B. weil kein passender Kurs zustande kommt — bekommst du den Geldbetrag automatisch erstattet.</p>`,'#f5f2f0')}${btn('Mein Guthaben',APP_URL+'/meine')}${LG}`)
        } else {
          const verrechnetSatz = verrechnet > 0 ? ` Dein verrechnetes Guthaben (${esc(verrechnet)} Credits) wurde nicht zurückgegeben — du bekommst stattdessen den entsprechenden Geldbetrag erstattet.` : ''
          html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">deine Wahl ist gespeichert — anteilige Erstattung.</p>${hl(`<p style="margin:4px 0;font-size:15px;font-weight:bold">Anteilige Erstattung</p><p style="margin:8px 0 0;font-size:14px">Kurs: ${cn}</p><p style="margin:4px 0;font-size:14px">✅ ${esc(refund)} Stunden werden anteilig erstattet</p>`,'#f0e6e6')}<p style="font-size:15px">Ich melde mich persönlich bei dir wegen der Auszahlung.${verrechnetSatz}</p>${btn('Zur App',APP_URL+'/meine')}${LG}`)
        }
        break
      }
      case 'admin_guthaben_verrechnet': {
        to = ADMIN_EMAIL
        const remaining = data.guthabenRemaining ?? 0
        const courseTotal = data.courseTotal ?? data.guthabenAmount
        const newCreds = data.newCreditsCount ?? Math.max(0, courseTotal - data.guthabenAmount)
        subject = `Guthaben verrechnet: ${data.yogiName} (${data.guthabenAmount}/${courseTotal} Credits)`
        html = base(`<p style="font-size:15px">Hallo Sarah,</p><p style="font-size:15px">beim Hinzufügen zu einem Kurs wurde Guthaben verrechnet:</p>${hl(`<p style="margin:4px 0;font-size:15px;font-weight:bold">${esc(data.guthabenAmount)} Credits aus Guthaben verrechnet</p><p style="margin:10px 0 4px;font-size:14px"><strong>${yogiName}</strong></p><p style="margin:4px 0;font-size:14px">${yogiEmail}</p><p style="margin:8px 0 0;font-size:14px">Kurs: ${cn}</p>`,'#e8ede6')}${hl(`<p style="margin:0 0 10px;font-size:14px;font-weight:bold">Buchhaltung</p><p style="margin:4px 0;font-size:14px">Kurs insgesamt: <strong>${esc(courseTotal)} Credits</strong></p><p style="margin:4px 0;font-size:14px;color:#3a5a30">Aus Guthaben verrechnet: <strong>${esc(data.guthabenAmount)} Credits</strong></p><p style="margin:4px 0;font-size:14px;color:#6b2a2a">Yogi muss neu bezahlen: <strong>${esc(newCreds)} Credits</strong></p>${remaining > 0 ? `<p style="margin:10px 0 0;font-size:14px">Verbleibendes Guthaben: <strong>${esc(remaining)} Credits</strong></p>` : '<p style="margin:10px 0 0;font-size:14px">✅ Guthaben vollständig aufgebraucht.</p>'}`,'#f5f2f0')}${btn('Yogi ansehen',APP_URL+'/admin/yogis')}`)
        break
      }
      case 'password_reset_request': {
        to = data.email
        subject = 'Passwort zurücksetzen – Yoga mit Sarah'
        const sbReset = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })
        const { data: linkData, error: linkError } = await sbReset.auth.admin.generateLink({
          type: 'recovery', email: data.email,
          options: { redirectTo: APP_URL + '/profil/passwort' }
        })
        if (linkError || !linkData?.properties?.hashed_token) {
          return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
        }
        const tokenHash = linkData.properties.hashed_token
        const resetUrl = `${APP_URL}/profil/passwort?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`
        html = base(`<p style="font-size:15px">Hallo,</p><p style="font-size:15px">du hast eine Passwort-Zurücksetzung angefordert.</p>${hl(`<p style="margin:0;font-size:15px">Klicke auf den Button. Der Link ist <strong>1 Stunde gültig</strong>.</p>`)}<div style="margin:20px 0">${btn('Neues Passwort festlegen',resetUrl)}</div><p style="font-size:13px;color:#999">Wenn du diese Anfrage nicht gestellt hast, ignoriere die E-Mail.</p>${LG}`)
        break
      }
      case 'admin_dsgvo_deletion':
        to = ADMIN_EMAIL
        subject = 'DSGVO: Account gelöscht – PDF bitte manuell löschen'
        html = base(`<p style="font-size:15px">Hallo Sarah,</p><p style="font-size:15px">folgender Account wurde DSGVO-konform gelöscht:</p>${hl(`<p style="margin:4px 0;font-size:14px"><strong>${fullName}</strong></p><p style="margin:4px 0;font-size:14px">${esc(data.email)}</p>`)}<p style="font-size:15px">Bitte lösche die AGB-PDF im Google Drive manuell. Suche nach: "${fullName}"</p>`)
        break
      case 'admin_new_yogi':
        to = ADMIN_EMAIL
        subject = `Neuer Yogi: ${data.fullName}`
        html = base(`<p style="font-size:15px">Hallo Sarah,</p><p style="font-size:15px">ein neuer Yogi hat sich registriert!</p>${hl(`<p style="margin:4px 0;font-size:14px"><strong>${fullName}</strong></p><p style="margin:4px 0;font-size:14px">${esc(data.email)}</p>${data.courseName?`<p style="margin:4px 0;font-size:14px">Kurs: ${cn}</p>`:''}` )}${btn('Yogis verwalten',APP_URL+'/admin/yogis')}`)
        break
      case 'illness_credit': {
        subject = `Krankheits-Austragung: ${data.courseName}`
        const expiryStr = fmtDate(data.expiresAt)
        html = base(`<p style="font-size:15px">Liebe/r ${fn},</p><p style="font-size:15px">gemäß deinem vorgelegten Attest habe ich dich aus dem Kurs <strong>„${cn}"</strong> ausgetragen.</p>${hl(`<p style="margin:4px 0;font-size:15px;font-weight:bold;color:#3a5a30">✅ ${esc(data.hoursCredited)} Stunden Guthaben gutgeschrieben</p><p style="margin:8px 0 0;font-size:14px">Gültig bis <strong>${esc(expiryStr)}</strong></p>`,'#e8ede6')}<p style="font-size:15px">Du erhältst ein Guthaben über ${esc(data.hoursCredited)} Stunden für einen neuen Kurs.</p><p style="font-size:14px;color:#666">Hinweis: Mit der Krankheits-Austragung sind eventuell offene Vorhol- und Nachholbuchungen ersatzlos beendet. Das Guthaben kann nur für die Buchung eines neuen Kurses verwendet werden, wenn dort ein Platz frei ist — eine Auszahlung in Geld ist ausgeschlossen.</p>${btn('Mein Guthaben',APP_URL+'/meine')}<p style="font-size:15px">Werde schnell wieder gesund — ich freue mich, dich wiederzusehen.</p>${LG}`)
        break
      }
      case 'admin_guthaben_2y_expiry': {
        to = ADMIN_EMAIL
        subject = `Guthaben nach 2 Jahren abgelaufen: ${data.yogiName} — bitte erstatten`
        html = base(`<p style="font-size:15px">Hallo Sarah,</p><p style="font-size:15px">ein Guthaben aus einem Kursabbruch ist heute nach 2 Jahren abgelaufen, ohne eingelöst worden zu sein. Gemäß AGB musst du den Geldbetrag jetzt automatisch erstatten:</p>${hl(`<p style="margin:4px 0;font-size:15px;font-weight:bold">${esc(data.unusedCredits)} ungenutzte Credits</p><p style="margin:10px 0 4px;font-size:14px"><strong>${yogiName}</strong></p><p style="margin:4px 0;font-size:14px">${yogiEmail}</p>${data.originalCourseName ? `<p style="margin:8px 0 0;font-size:14px">Ursprünglicher Kurs: ${esc(data.originalCourseName)}</p>` : ''}<p style="margin:4px 0;font-size:14px">Guthaben-Vergabe: ${data.creditCreatedAt ? esc(new Date(data.creditCreatedAt).toLocaleDateString('de-DE')) : '—'}</p>`,'#f0e6e6')}<p style="font-size:15px">Bitte überweise den Betrag (Höhe gemäß deiner Kurspreis-Liste) und markiere die Aufgabe im Admin-Dashboard als erledigt.</p>${btn('Zum Admin-Dashboard',APP_URL+'/admin/dashboard')}`)
        break
      }
      case 'account_deleted_yogi': {
        to = data.email
        subject = 'Dein Account bei Yoga mit Sarah wurde gelöscht'
        html = base(`<p style="font-size:15px">Hallo ${fn},</p><p style="font-size:15px">deine Account-Löschung wurde soeben durchgeführt. Was passiert ist:</p>${hl(`<p style="margin:6px 0;font-size:14px">✅ Alle deine Stammdaten (Name, Telefon, Geburtsdatum, Notfallkontakt) wurden aus unserer Datenbank entfernt</p><p style="margin:6px 0;font-size:14px">✅ Alle deine zukünftigen Buchungen wurden storniert</p><p style="margin:6px 0;font-size:14px">✅ Deine Buchungshistorie wurde gelöscht</p><p style="margin:6px 0;font-size:14px">✅ Im internen Protokoll wurde deine Nutzer-ID anonymisiert (bleibt 24 Monate ohne Personenbezug erhalten — Details in der Datenschutzerklärung)</p><p style="margin:6px 0;font-size:14px">✅ <strong>Mit dem Versand dieser Bestätigungs-E-Mail wird auch deine E-Mail-Adresse aus unserer Datenbank entfernt.</strong> Diese eine Mail ist die letzte Nachricht, die du von mir erhältst.</p>`,'#e8ede6')}${hl(`<p style="margin:0;font-size:14px;color:#6b2a2a"><strong>Wichtig:</strong> Falls du noch offene Credits oder Guthaben hattest, sind diese mit der Löschung ebenfalls verfallen (siehe AGB § 1.0). Eine Rückerstattung erfolgt nicht.</p>`,'#f0e6e6')}<p style="font-size:15px">Falls du dich später wieder anmelden möchtest, kannst du jederzeit einen neuen Account anlegen — du startest dann bei null.</p><p style="font-size:15px">Bei Fragen erreichst du mich unter Mail@yogamitsarah.me.</p>${LG}`)
        break
      }
      default:
        return new Response(JSON.stringify({ error: 'Unknown type: '+type }), { status: 400, headers: CORS })
    }
    const result = await sendEmail(to, subject, html)
    return new Response(JSON.stringify({ ok: result.ok, status: result.status }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch(e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
