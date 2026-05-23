/**
 * Page-Fade beim Tab/Route-Wechsel (Sarah-Wunsch 2026-05-23 v3).
 *
 * template.tsx — Next.js App-Router-Konvention. Im Gegensatz zu layout.tsx
 * wird template.tsx bei jedem Route-Wechsel neu gemountet. Das triggert
 * die CSS-Animation `.page-fade` automatisch jedes Mal — kein useEffect,
 * kein key={pathname}, kein 'use client' nötig.
 *
 * Effekt: kurzer Fade + leichter Slide-Up beim Wechsel zwischen Kurse /
 * Meine / Warteliste / Profil etc. — weicher Yoga-Mood statt instant cut.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-fade">{children}</div>
}
