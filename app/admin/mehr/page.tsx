/**
 * Admin-Mehr-Page auf Laptop (Sarah-Wunsch 2026-05-23 v5).
 *
 * Liegt unter /admin/mehr — damit die Admin-Sidebar erhalten bleibt.
 * Inhalt: 1:1 derselbe wie /profil (der zeigt für Admins automatisch den
 * Mehr-Block: Nachricht für Yogis, E-Mail an alle Yogis, AGB-Verwaltung,
 * System-Status, Passwort, Logout, Protokoll-Toggle).
 *
 * Re-Export statt Code-Duplikation: ein Quellfile, zwei Routen.
 * Auf Mobile gehen Admins weiterhin via BottomNav "Mehr" → /profil
 * (kompakter, ohne Sidebar). Auf Laptop via Sidebar "Mehr" → /admin/mehr.
 */
export { default } from '@/app/profil/page'
