/**
 * Supabase Service-Role-Client für Test-Setup und Datenbankprüfungen.
 * Wird NUR in Test-Hilfsfunktionen verwendet – nicht in der App!
 */
import { createClient } from '@supabase/supabase-js'

export function getServiceClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen in .env.test gesetzt sein')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// ── Bookings ────────────────────────────────────────────────────────────────

export async function getActiveBooking(userId: string, sessionId: string) {
  const db = getServiceClient()
  const { data } = await db.from('bookings')
    .select('*').eq('user_id', userId).eq('session_id', sessionId)
    .eq('status', 'active').maybeSingle()
  return data
}

export async function getCancelledBooking(userId: string, sessionId: string) {
  const db = getServiceClient()
  const { data } = await db.from('bookings')
    .select('*').eq('user_id', userId).eq('session_id', sessionId)
    .eq('status', 'cancelled').maybeSingle()
  return data
}

// ── Credits ─────────────────────────────────────────────────────────────────

export async function getCredit(userId: string, courseId?: string) {
  const db = getServiceClient()
  let q = db.from('credits').select('*').eq('user_id', userId)
  if (courseId) q = q.eq('course_id', courseId)
  const { data } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

export async function getSingleCredit(userId: string) {
  const db = getServiceClient()
  const { data } = await db.from('credits')
    .select('*').eq('user_id', userId).eq('model', 'single')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

export async function getGuthabenCredit(userId: string) {
  const db = getServiceClient()
  const { data } = await db.from('credits')
    .select('*').eq('user_id', userId).eq('model', 'guthaben')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

// ── Waitlist ─────────────────────────────────────────────────────────────────

export async function getWaitlistEntry(userId: string, sessionId: string) {
  const db = getServiceClient()
  const { data } = await db.from('waitlist')
    .select('*').eq('user_id', userId).eq('session_id', sessionId).maybeSingle()
  return data
}

// ── Profile ──────────────────────────────────────────────────────────────────

export async function getProfile(email: string) {
  const db = getServiceClient()
  const { data } = await db.from('profiles').select('*').eq('email', email).maybeSingle()
  return data
}

export async function getUserIdByEmail(email: string): Promise<string | null> {
  const db = getServiceClient()
  const { data } = await db.auth.admin.listUsers()
  const user = data?.users?.find(u => u.email === email)
  return user?.id ?? null
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function getSession(sessionId: string) {
  const db = getServiceClient()
  const { data } = await db.from('sessions').select('*, course:courses(*)').eq('id', sessionId).maybeSingle()
  return data
}

export async function countActiveBookingsForSession(sessionId: string): Promise<number> {
  const db = getServiceClient()
  const { count } = await db.from('bookings')
    .select('id', { count: 'exact' }).eq('session_id', sessionId).eq('status', 'active')
  return count ?? 0
}
