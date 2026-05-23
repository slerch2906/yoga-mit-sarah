/**
 * AGB-Versionierung — Sarah-Wunsch 2026-05-23 (Variante A).
 *
 * Versionen + Changelogs werden in der DB-Tabelle `agb_versions` gepflegt.
 * Admin kann neue Version via Profil-Formular einspielen.
 * Yogis bekommen beim Login automatisch eine Re-Acceptance angezeigt
 * wenn ihre profiles.agb_version < aktuelle Version-sort_order ist.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type AgbVersion = {
  id: string
  label: string         // z.B. "Dezember 2025"
  changelog: string     // z.B. "Stornofrist von 4h auf 3h verkürzt..."
  sort_order: number    // aufsteigend; höchster = aktuell
  created_at: string
}

/** Lädt die aktuell gültige Version (höchste sort_order). */
export async function getCurrentAgbVersion(supabase: SupabaseClient): Promise<AgbVersion | null> {
  const { data, error } = await supabase.from('agb_versions')
    .select('*').order('sort_order', { ascending: false }).limit(1).maybeSingle()
  if (error) {
    console.error('[getCurrentAgbVersion] DB-Error:', error.message, error)
    return null
  }
  return (data as AgbVersion) || null
}

/** Lädt die Version mit gegebener sort_order. Für Anzeige "Was hat sich seit Version X geändert" */
export async function getAgbVersionByOrder(supabase: SupabaseClient, sortOrder: number): Promise<AgbVersion | null> {
  const { data } = await supabase.from('agb_versions')
    .select('*').eq('sort_order', sortOrder).maybeSingle()
  return (data as AgbVersion) || null
}

/** Lädt alle Versionen ZWISCHEN previousOrder (exklusiv) und currentOrder (inklusiv).
 *  Für die Re-Acceptance-Anzeige: "Was hat sich seit deiner letzten Bestätigung geändert" */
export async function getAgbChangelogSince(supabase: SupabaseClient, sinceOrder: number): Promise<AgbVersion[]> {
  const { data } = await supabase.from('agb_versions')
    .select('*').gt('sort_order', sinceOrder).order('sort_order', { ascending: true })
  return (data || []) as AgbVersion[]
}
