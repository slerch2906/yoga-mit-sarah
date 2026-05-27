// Welle S2/M10 (Sarah 2026-05-27):
// PostgREST-OR-Filter (z.B. `first_name.ilike.%foo%,...`) bricht bei Sonderzeichen
// im Such-String — Apostroph ("O'Brien"), Komma, Klammern oder %-Wildcards
// werden als Trennzeichen / Wildcard interpretiert und der Query crasht
// mit "PGRST100" oder liefert verfaelschte Resultate. Da Sarahs Yogi-Suche
// nie regex-Faehigkeiten braucht, ist das simpelste Modell: Sonderzeichen
// entfernen + Laenge cappen. Bei Such-Strings < 2 Zeichen liefert die UI
// sowieso schon leere Ergebnisse, wir geben einen leeren String zurueck damit
// der Caller das selbe Verhalten beibehaelt.
export function escapeForOrFilter(s: string): string {
  if (!s) return ''
  return s.trim().slice(0, 50).replace(/[%,()'"\\]/g, '')
}
