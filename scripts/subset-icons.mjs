// Performance-Fix (Sarah 2026-08-18): die App lud bisher das komplette Tabler-
// Icon-Set (~1.2 MB Font+CSS fuer ~5900 Icons), obwohl nur eine Handvoll
// tatsaechlich benutzt wird. Dieses Skript baut daraus eine winzige, exakt auf
// die verwendeten Icons zugeschnittene Font+CSS.
//
// Aufruf: node scripts/subset-icons.mjs
// Output: public/fonts/tabler-icons-subset.woff2 + styles/tabler-icons-subset.css
//
// Bei neuen Icons im Code: Skript einfach erneut laufen lassen — es scannt
// den kompletten Code neu und baut die Subset-Dateien komplett neu.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import subsetFont from 'subset-font'

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..'
const SRC_CSS = path.join(ROOT, 'node_modules/@tabler/icons-webfont/dist/tabler-icons.css')
const SRC_WOFF2 = path.join(ROOT, 'node_modules/@tabler/icons-webfont/dist/fonts/tabler-icons.woff2')
const OUT_FONT_DIR = path.join(ROOT, 'public/fonts')
const OUT_FONT_FILE = 'tabler-icons-subset.woff2'
const OUT_CSS = path.join(ROOT, 'styles/tabler-icons-subset.css')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full)
  }
  return out
}

// 1) Alle im Code verwendeten "ti-xxx"-Klassennamen sammeln.
const codeFiles = [
  ...walk(path.join(ROOT, 'app')),
  ...walk(path.join(ROOT, 'components')),
]
const usedClasses = new Set()
const classRe = /\bti-[a-z][a-z0-9-]*\b/g
for (const file of codeFiles) {
  const src = fs.readFileSync(file, 'utf8')
  for (const m of src.matchAll(classRe)) usedClasses.add(m[0])
}
console.log(`Gefundene Icon-Klassen im Code: ${usedClasses.size}`)

// 2) Aus der Original-CSS: Klassenname -> Unicode-Codepoint.
const srcCss = fs.readFileSync(SRC_CSS, 'utf8')
const codepointByClass = new Map()
const ruleRe = /\.(ti-[a-z0-9-]+):before\s*{\s*content:\s*"\\([0-9a-f]+)";?\s*}/gi
for (const m of srcCss.matchAll(ruleRe)) {
  codepointByClass.set(m[1], parseInt(m[2], 16))
}

// 3) Abgleich: Klassen die es in der Original-CSS nicht gibt, koennen nicht
// gerendert werden — das ist unabhaengig von diesem Skript so (entweder ein
// Tippfehler im Code, oder (bei "ti-chevron" o.ae.) ein Artefakt aus
// `ti-chevron-${...}`-Konstrukten, deren echte Werte an anderer Stelle im
// Code bereits statisch vorkommen). Nur warnen, nicht abbrechen.
const missing = [...usedClasses].filter(c => !codepointByClass.has(c))
if (missing.length > 0) {
  console.warn('WARNUNG: folgende Icon-Klassen aus dem Code gibt es nicht in der Tabler-CSS (bereits vor diesem Skript ohne Icon, unveraendert):')
  console.warn(missing.join(', '))
}
const resolvedClasses = [...usedClasses].filter(c => codepointByClass.has(c))

const usedCodepoints = resolvedClasses.map(c => codepointByClass.get(c))
const uniqueCodepoints = [...new Set(usedCodepoints)].sort((a, b) => a - b)
console.log(`Eindeutige Codepoints: ${uniqueCodepoints.length}`)

// 4) Font subsetten (nur die benoetigten Glyphen behalten).
const chars = uniqueCodepoints.map(cp => String.fromCodePoint(cp)).join('')
const originalWoff2 = fs.readFileSync(SRC_WOFF2)
const subsetBuffer = await subsetFont(originalWoff2, chars, { targetFormat: 'woff2' })

fs.mkdirSync(OUT_FONT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUT_FONT_DIR, OUT_FONT_FILE), subsetBuffer)
console.log(`Subset-Font geschrieben: ${(subsetBuffer.length / 1024).toFixed(1)} KB (Original: ${(originalWoff2.length / 1024).toFixed(1)} KB)`)

// 5) Minimale CSS bauen: @font-face + .ti Basis-Klasse + nur die :before-Regeln
//    fuer tatsaechlich verwendete Icons.
const sortedClasses = [...resolvedClasses].sort()
const beforeRules = sortedClasses
  .map(c => `.${c}:before{content:"\\${codepointByClass.get(c).toString(16)}"}`)
  .join('\n')

const css = `/* AUTO-GENERIERT von scripts/subset-icons.mjs — nicht von Hand bearbeiten. */
@font-face{
  font-family:"tabler-icons";
  font-style:normal;
  font-weight:400;
  src:url("/fonts/${OUT_FONT_FILE}") format("woff2");
  font-display:swap;
}
.ti{
  font-family:"tabler-icons" !important;
  speak:none;
  font-style:normal;
  font-weight:normal;
  font-variant:normal;
  text-transform:none;
  line-height:1;
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
}
${beforeRules}
`
fs.mkdirSync(path.dirname(OUT_CSS), { recursive: true })
fs.writeFileSync(OUT_CSS, css)
console.log(`Subset-CSS geschrieben: ${path.relative(ROOT, OUT_CSS)} (${sortedClasses.length} Icon-Regeln)`)
