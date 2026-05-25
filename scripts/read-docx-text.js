/* Extrahiert reinen Text aus einem entpackten document.xml — paragrafenweise.
 * Markiert Heading-Stufen + ausgefüllte Checkboxen. */
const fs = require('fs')
const xml = fs.readFileSync(process.argv[2] || '/tmp/sarah-doc/word/document.xml', 'utf8')

// Match every <w:p>...</w:p>
const pRegex = /<w:p[ >][\s\S]*?<\/w:p>/g
const paragraphs = xml.match(pRegex) || []
console.log('Total paragraphs:', paragraphs.length)
console.log('---')

paragraphs.forEach((p, i) => {
  // Heading detection
  let heading = ''
  const styleMatch = p.match(/<w:pStyle w:val="(Heading\d|TOC\d)"\s*\/?>/)
  if (styleMatch) heading = '[' + styleMatch[1] + '] '

  // Checkbox detection (Word checkbox = w14:checkbox or sym font)
  // Our generated checkboxes are SDT (structured doc tags) — we need to look for checked/unchecked
  const checkboxes = p.match(/<w14:checkbox>[\s\S]*?<\/w14:checkbox>/g) || []
  const cbStates = checkboxes.map(cb => cb.match(/<w14:checked w14:val="1"\/>/) ? '☒' : '☐').join(' ')

  // Extract all text runs
  const tRegex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
  let text = ''
  let m
  while ((m = tRegex.exec(p)) !== null) {
    text += m[1]
  }
  // Decode XML entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))

  if (text.trim() || cbStates) {
    const prefix = heading || (cbStates ? '  ' : '  ')
    console.log(`${prefix}${cbStates ? cbStates + ' ' : ''}${text}`)
  }
})
