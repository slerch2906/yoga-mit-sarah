// Wochenbericht-Export (Sarah 2026-06): rein additive, read-only Auswertung.
// Liest die Report-Daten (DB-Funktion report_weekly_json, nur SELECT), baut eine
// farbige Excel-Mappe (5 Register) und laedt sie als GOOGLE SHEET in den Drive-
// Ordner. Greift NICHT in App-Workflows ein. Wird woechentlich per pg_cron
// (Freitag) angestossen. ?dryrun=1 baut nur die Mappe (kein Upload) zum Testen.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import ExcelJS from 'npm:exceljs@4.4.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DRIVE_FOLDER_ID = '1z5jI641OyGDL0Qab1evahyJC8DEdGszB'

const COL = { grey:'FFD9D9D9', yellow:'FFFFF2CC', green:'FFE2EFDA', blue:'FFDDEBF7', amber:'FFFFF2CC', red:'FFF8CBAD' }
const fillFor = (cat: string|null) => cat ? { type:'pattern' as const, pattern:'solid' as const, fgColor:{ argb: (COL as any)[cat] } } : null
const thin = { style:'thin' as const, color:{ argb:'FFBFBFBF' } }
const BORDER = { top:thin, left:thin, bottom:thin, right:thin }

function explRows(ws: any, expl: any[], lastCol: string) {
  for (const line of expl) {
    const r = ws.addRow([line.t])
    ws.mergeCells(`A${r.number}:${lastCol}${r.number}`)
    const c = ws.getCell(`A${r.number}`)
    c.font = { name:'Arial', size: line.title ? 14 : 11, bold: !!line.bold, color: line.title ? { argb:'FF3D3A39' } : (line.stamp ? { argb:'FF8A6020' } : undefined) }
    c.alignment = { wrapText:true, vertical:'middle' }
  }
}
function buildTable(ws: any, cols: string[], cats: (string|null)[], data: any[][], expl: any[], lastCol: string, widths: number[]) {
  explRows(ws, expl, lastCol)
  const lr = ws.addRow(['Farben:', 'Gesamtzahl', 'Vergangenheit / erledigt', 'Zukunft / offen'])
  lr.font = { name:'Arial', bold:true }
  ws.getCell(`B${lr.number}`).fill = fillFor('grey'); ws.getCell(`C${lr.number}`).fill = fillFor('yellow'); ws.getCell(`D${lr.number}`).fill = fillFor('green')
  ;['B','C','D'].forEach(cc => ws.getCell(`${cc}${lr.number}`).border = BORDER)
  ws.addRow([])
  const hr = ws.addRow(cols); const headerNum = hr.number
  hr.alignment = { wrapText:true, vertical:'middle', horizontal:'center' }
  for (const row of data) ws.addRow(row)
  const lastRow = ws.rowCount
  for (let col = 1; col <= cols.length; col++) {
    const fill = fillFor(cats[col-1])
    for (let rn = headerNum; rn <= lastRow; rn++) {
      const cell = ws.getRow(rn).getCell(col)
      if (fill) cell.fill = fill
      cell.border = BORDER; cell.font = { name:'Arial', bold: rn === headerNum }
      if (rn > headerNum && col >= 6) cell.alignment = { horizontal:'center' }
    }
  }
  ws.views = [{ state:'frozen', ySplit: headerNum }]
  widths.forEach((w,i) => ws.getColumn(i+1).width = w)
  ws.getRow(headerNum).height = 42
}
function buildSimple(ws: any, cols: string[], data: any[][], expl: any[], lastCol: string, widths: number[], emptyNote: string) {
  explRows(ws, expl, lastCol)
  const hr = ws.addRow(cols); const headerNum = hr.number
  for (let i=1;i<=cols.length;i++){ const cell=ws.getRow(headerNum).getCell(i); cell.font={name:'Arial',bold:true}; cell.border=BORDER; cell.fill=fillFor('grey'); cell.alignment={horizontal:'center',wrapText:true} }
  if (data.length) {
    for (const row of data) ws.addRow(row)
    for (let rn=headerNum+1; rn<=ws.rowCount; rn++) for (let c=1;c<=cols.length;c++){ const cell=ws.getRow(rn).getCell(c); cell.border=BORDER; cell.font={name:'Arial'} }
  } else {
    const nr = ws.addRow([emptyNote]); ws.mergeCells(`A${nr.number}:${lastCol}${nr.number}`)
    ws.getCell(`A${nr.number}`).font = { name:'Arial', italic:true, color:{ argb:'FF808080' } }
  }
  ws.views = [{ state:'frozen', ySplit: headerNum }]
  widths.forEach((w,i) => ws.getColumn(i+1).width = w)
}

function buildWorkbook(data: any): any {
  const STAMP = `Datenauszug vom: ${data.stand}`
  const wb = new ExcelJS.Workbook()

  // Blatt 1: Kurse
  const ws1 = wb.addWorksheet('Kurse')
  const KCOLS = ['Name','Kurs','Tag','Uhr','Zeitraum','Gesamt Kurs','Teilgenommen','Rechtzeitig abgemeldet','Zu spät abgemeldet','Vorgezogen','Nachgeholt','Noch offene Kurstermine','davon angemeldet','davon abgemeldet','Freie Credits','Gültig bis']
  const KCATS = [null,null,null,null,null,'grey','yellow','yellow','yellow','yellow','yellow','green','green','green','green',null]
  const KDATA = (data.kurse||[]).map((r: any) => [r.name,r.kurs,r.tag,r.uhr,r.zeitraum,r.gesamt,r.teilgenommen,r.rechtzeitig,r.zuspaet,r.vorgezogen,r.nachgeholt,r.offen,r.angemeldet,r.abgemeldet,r.frei,r.gueltig])
  buildTable(ws1, KCOLS, KCATS, KDATA, [
    { t:'WOCHENBERICHT — Yoga mit Sarah', title:true, bold:true },
    { t:STAMP, stamp:true, bold:true },
    { t:'Read-only-Auswertung aus der App. Register: Kurse · Guthaben & Punktekarten · Kalender · Vor-/Nachholungen · Event-Anmeldungen.' },
    { t:'' },
    { t:'GRAU = Gesamt · GELB = Vergangenheit/erledigt · GRÜN = Zukunft/offen.', bold:true },
    { t:'WIE VIEL STEHT NOCH ZU  =  „davon angemeldet"  +  „Freie Credits"', bold:true },
    { t:'Kontrolle 1: Teilgenommen + Rechtzeitig abgemeldet + Zu spät abgemeldet + davon angemeldet = Gesamt Kurs' },
    { t:'Kontrolle 2: Noch offene Kurstermine = davon angemeldet + davon abgemeldet' },
    { t:'Kontrolle 3: Freie Credits = Rechtzeitig abgemeldet − Vorgezogen − Nachgeholt' },
    { t:'' },
  ], 'P', [22,20,11,7,17,9,11,13,12,11,11,13,12,12,10,11])

  // Blatt 2: Guthaben & Punktekarten
  const ws2 = wb.addWorksheet('Guthaben & Punktekarten')
  const GDATA = (data.guthaben||[]).map((r: any) => [r.name,r.art,r.gesamt,r.genutzt,r.frei,r.herkunft,r.aus_kurs,r.gueltig])
  buildSimple(ws2, ['Name','Art','Gesamt','Genutzt','Frei','Herkunft','Aus Kurs','Gültig bis'], GDATA, [
    { t:'GUTHABEN & PUNKTEKARTEN', title:true, bold:true },
    { t:STAMP, stamp:true, bold:true },
    { t:'Diese Stunden gehören ZUSÄTZLICH zum Anspruch. Punktekarte = Drop-in-Karte · Guthaben = aus Kursabbruch (2 J) / Krankheit (10 Mo).' },
    { t:'' },
  ], 'H', [22,14,9,9,8,16,16,11], 'Bisher keine Guthaben/Punktekarten.')

  // Blatt 3: Kalender
  const ws3 = wb.addWorksheet('Kalender')
  const ST: any = { 'T':{t:'teilg.',c:'green'},'A':{t:'angem.',c:'blue'},'R':{t:'abgem.',c:'amber'},'S':{t:'zu spät',c:'red'},'X':{t:'abgesagt',c:'grey'},'-':{t:'—',c:null} }
  explRows(ws3, [
    { t:'KALENDER — Status pro Yogi und Termin', title:true, bold:true },
    { t:STAMP, stamp:true, bold:true },
    { t:'teilg. = teilgenommen · angem. = angemeldet · abgem. = rechtzeitig abgemeldet · zu spät = zu spät · abgesagt = ganze Stunde abgesagt · — = nicht gebucht.' },
    { t:'' },
  ], 'L')
  const datesByKurs: any = {}
  for (const d of (data.kal_dates||[])) datesByKurs[d.kurs] = { tag:d.tag, uhr:d.uhr, dates:(d.dates||'').split('|').filter((x:string)=>x) }
  const rowsByKurs: any = {}
  for (const r of (data.kal_rows||[])) { (rowsByKurs[r.kurs] = rowsByKurs[r.kurs]||[]).push({ name:r.name, stati:(r.stati||'').split('|') }) }
  let maxCols = 1
  for (const kurs of Object.keys(datesByKurs)) {
    const info = datesByKurs[kurs]; const ncol = 1 + info.dates.length; if (ncol>maxCols) maxCols=ncol
    const tr = ws3.addRow([`${kurs}  (${info.tag||''} ${info.uhr||''})`]); ws3.mergeCells(`A${tr.number}:${ws3.getColumn(ncol).letter}${tr.number}`)
    ws3.getCell(`A${tr.number}`).font = { name:'Arial', size:12, bold:true, color:{ argb:'FF8A6020' } }
    const hr = ws3.addRow(['Name', ...info.dates]); const hn = hr.number
    for (let i=1;i<=ncol;i++){ const cell=ws3.getRow(hn).getCell(i); cell.font={name:'Arial',bold:true}; cell.border=BORDER; cell.alignment={horizontal:'center'}; cell.fill=fillFor('grey') }
    for (const yr of (rowsByKurs[kurs]||[])) {
      const row = ws3.addRow([yr.name, ...yr.stati.map((s:string)=>(ST[s]||ST['-']).t)]); const rn = row.number
      ws3.getRow(rn).getCell(1).border = BORDER; ws3.getRow(rn).getCell(1).font={name:'Arial'}
      for (let i=0;i<yr.stati.length;i++){ const cell=ws3.getRow(rn).getCell(2+i); const inf=ST[yr.stati[i]]||ST['-']; if(inf.c) cell.fill=fillFor(inf.c); cell.border=BORDER; cell.alignment={horizontal:'center'}; cell.font={name:'Arial',size:10} }
    }
    ws3.addRow([])
  }
  if (Object.keys(datesByKurs).length === 0) ws3.addRow(['Bisher keine Kurse.'])
  ws3.getColumn(1).width = 22; for (let i=2;i<=maxCols;i++) ws3.getColumn(i).width = 9
  ws3.views = [{ state:'frozen', xSplit:1 }]

  // Blatt 4: Vor-/Nachholungen
  const ws4 = wb.addWorksheet('Vor-Nachholungen')
  const VDATA = (data.vorhol||[]).map((r:any)=>[r.yogi,r.art,r.ersatz_am,r.ersatz_uhr,r.was,r.ersetzt,r.kurs])
  buildSimple(ws4, ['Yogi','Art','Ersatzstunde am','Uhr','Was (Titel / Typ)','Ersetzt Kursstunde vom','aus Kurs'], VDATA, [
    { t:'VOR- / NACHHOLUNGEN', title:true, bold:true },
    { t:STAMP, stamp:true, bold:true },
    { t:'Jede Ersatzstunde: wer · wann · welche Einzelstunde/anderer Kurs — und welche abgesagte Kursstunde sie ersetzt.' },
    { t:'' },
  ], 'G', [22,12,15,7,28,20,20], 'Bisher keine Vor-/Nachholungen.')

  // Blatt 5: Event-Anmeldungen
  const ws5 = wb.addWorksheet('Event-Anmeldungen')
  const EDATA = (data.events||[]).map((r:any)=>[r.event,r.datum,r.uhr,r.typ,r.yogi,r.status])
  buildSimple(ws5, ['Event','Datum','Uhr','Typ','Yogi','Status'], EDATA, [
    { t:'EVENT-ANMELDUNGEN', title:true, bold:true },
    { t:STAMP, stamp:true, bold:true },
    { t:'Wer hat sich für welches Event angemeldet (kostenlose + bezahlte Events).' },
    { t:'' },
  ], 'F', [30,12,7,14,24,12], 'Bisher keine Events angelegt.')

  return wb
}

async function fetchReport(): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/report_weekly_json`, {
    method:'POST', headers:{ 'Content-Type':'application/json', apikey:SERVICE_KEY, Authorization:`Bearer ${SERVICE_KEY}` }, body:'{}',
  })
  if (!res.ok) throw new Error('RPC report_weekly_json failed: ' + await res.text())
  return await res.json()
}

async function getAccessToken(): Promise<string> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID'); const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET'); const refreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN')
  if (!clientId || !clientSecret || !refreshToken) throw new Error('GOOGLE_* secrets not configured')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id:clientId, client_secret:clientSecret, refresh_token:refreshToken, grant_type:'refresh_token' }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data))
  return data.access_token
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''; const chunk = 0x8000
  for (let i=0;i<bytes.length;i+=chunk) bin += String.fromCharCode(...bytes.subarray(i, i+chunk))
  return btoa(bin)
}
const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers:{ 'Content-Type':'application/json' } })

async function driveCreateAsSheet(token: string, name: string, buf: Uint8Array): Promise<string> {
  const boundary = 'wb_' + Math.abs(Date.now()).toString(16)
  const metadata = JSON.stringify({ name, mimeType:'application/vnd.google-apps.spreadsheet', parents:[DRIVE_FOLDER_ID] })
  const body = [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', metadata,
    `--${boundary}`, 'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Transfer-Encoding: base64', '', toBase64(buf),
    `--${boundary}--`,
  ].join('\r\n')
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
    method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':`multipart/related; boundary="${boundary}"` }, body,
  })
  const d = await res.json(); if (!res.ok) throw new Error(JSON.stringify(d)); return d.id
}
async function driveFindByName(token: string, name: string): Promise<string|null> {
  const q = encodeURIComponent(`'${DRIVE_FOLDER_ID}' in parents and name = '${name}' and trashed = false`)
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers:{ Authorization:`Bearer ${token}` } })
  const d = await res.json(); return (d.files && d.files[0] && d.files[0].id) || null
}

serve(async (req) => {
  const url = new URL(req.url)
  const dryrun = url.searchParams.get('dryrun') === '1'
  const mode = url.searchParams.get('mode') // 'aktuell' = eine taeglich frische Datei; sonst woechentliches Archiv
  try {
    const data = await fetchReport()
    const wb = buildWorkbook(data)
    const buf = new Uint8Array(await wb.xlsx.writeBuffer())
    if (dryrun) return json({ ok:true, dryrun:true, size_kb: Math.round(buf.length/1024), kurse: (data.kurse||[]).length, stand: data.stand })

    const token = await getAccessToken()
    if (mode === 'aktuell') {
      // EINE Datei, taeglich frisch: alte loeschen, neue mit gleichem Namen anlegen.
      const name = 'Yoga-Bericht AKTUELL'
      const oldId = await driveFindByName(token, name)
      const newId = await driveCreateAsSheet(token, name, buf)
      if (oldId) await fetch(`https://www.googleapis.com/drive/v3/files/${oldId}?supportsAllDrives=true`, { method:'DELETE', headers:{ Authorization:`Bearer ${token}` } })
      return json({ ok:true, refreshed:true, fileId:newId, name, stand:data.stand })
    }
    // Woechentliches Archiv: neue, datierte Datei.
    const name = `Wochenbericht (Stand ${data.stand})`
    const id = await driveCreateAsSheet(token, name, buf)
    return json({ ok:true, fileId:id, name, stand:data.stand })
  } catch (e) {
    console.error('wochenbericht-export error:', e)
    return json({ ok:false, error: String(e) }, 500)
  }
})
