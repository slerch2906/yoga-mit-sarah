/**
 * Supabase-Clients für Test-Hilfsfunktionen.
 * - getServiceClient(): service_role key → nur für auth.admin Operationen
 * - getAdminClient(): meldet sich als Test-Admin an → für alle DB-Operationen
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js'

export function getServiceClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen in .env.test gesetzt sein')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

let _adminClient: SupabaseClient | null = null

export async function getAdminClient(): Promise<SupabaseClient> {
  if (_adminClient) {
    const { data: { session } } = await _adminClient.auth.getSession()
    if (session) return _adminClient
  }

  const client = getServiceClient()

  const { error } = await client.auth.signInWithPassword({
    email: process.env.TEST_ADMIN_EMAIL!,
    password: process.env.TEST_ADMIN_PASSWORD!,
  })
  if (error) throw new Error(`Admin-Login für Tests fehlgeschlagen: ${error.message}`)

  _adminClient = client
  return client
}

// ── Bookings ────────────────────────────────────────────────────────────────

export async function getActiveBooking(userId: string, sessionId: string) {
  const db = await getAdminClient()
  const { data } = await db.from('bookings')
    .select('*').eq('user_id', userId).eq('session_id', sessionId)
    .eq('status', 'active').maybeSingle()
  return data
}

export async function getCancelledBooking(userId: string, sessionId: string) {
  const db = await getAdminClient()
  const { data } = await db.from('bookings')
    .select('*').eq('user_id', userId).eq('session_id', sessionId)
    .eq('status', 'cancelled').maybeSingle()
  return data
}

// ── Credits ─────────────────────────────────────────────────────────────────

export async function getCredit(userId: string, courseId?: string) {
  const db = await getAdminClient()
  let q = db.from('credits').select('*').eq('user_id', userId)
  if (courseId) q = q.eq('course_id', courseId)
  const { data } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

export async function getSingleCredit(userId: string) {
  const db = await getAdminClient()
  const { data } = await db.from('credits')
    .select('*').eq('user_id', userId).eq('model', 'single')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

export async function getGuthabenCredit(userId: string) {
  const db = await getAdminClient()
  const { data } = await db.from('credits')
    .select('*').eq('user_id', userId).eq('model', 'guthaben')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

// ── Waitlist ─────────────────────────────────────────────────────────────────

export async function getWaitlistEntry(userId: string, sessionId: string) {
  const db = await getAdminClient()
  const { data } = await db.from('waitlist')
    .select('*').eq('user_id', userId).eq('session_id', sessionId).maybeSingle()
  return data
}

// ── Profile ──────────────────────────────────────────────────────────────────

export async function getProfile(email: string) {
  const db = await getAdminClient()
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
  const db = await getAdminClient()
  const { data } = await db.from('sessions').select('*, course:courses(*)').eq('id', sessionId).maybeSingle()
  return data
}

export async function countActiveBookingsForSession(sessionId: string): Promise<number> {
  const db = await getAdminClient()
  const { count } = await db.from('bookings')
    .select('id', { count: 'exact' }).eq('session_id', sessionId).eq('status', 'active')
  return count ?? 0
}

// ── Courses ──────────────────────────────────────────────────────────────────

export async function getCourse(courseId: string) {
  const db = await getAdminClient()
  const { data } = await db.from('courses').select('*').eq('id', courseId).maybeSingle()
  return data
}

export async function getEnrollment(userId: string, courseId: string) {
  const db = await getAdminClient()
  const { data } = await db.from('enrollments')
    .select('*').eq('user_id', userId).eq('course_id', courseId).maybeSingle()
  return data
}

// ── Kursabbruch ──────────────────────────────────────────────────────────────

export async function getCancellationResponse(userId: string, courseId: string) {
  const db = await getAdminClient()
  const { data } = await db.from('course_cancellation_responses')
    .select('*').eq('user_id', userId).eq('course_id', courseId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data
}
