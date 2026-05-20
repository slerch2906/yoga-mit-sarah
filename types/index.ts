export type Profile = {
  id: string
  first_name: string
  last_name: string
  email: string
  is_admin: boolean
  created_at: string
}

export type Course = {
  id: string
  name: string
  weekday: string
  time_start: string
  duration_min: number
  location: string | null
  description: string | null
  bring_along: string | null
  difficulty: string | null
  max_spots: number
  total_units: number
  date_start: string
  date_end: string
  is_active: boolean
  is_single: boolean
  predecessor_id: string | null
  created_at: string
}

export type Session = {
  id: string
  course_id: string
  date: string
  time_start: string
  duration_min: number
  is_cancelled: boolean
  cancel_reason: string | null
  replacement_session_id: string | null
  created_at: string
  // joined
  course?: Course
  booking_count?: number
  my_booking?: Booking | null
  my_waitlist?: Waitlist | null
}

export type Credit = {
  id: string
  user_id: string
  course_id: string | null
  model: 'course' | 'tenpack' | 'quarterly'
  total: number
  used: number
  expires_at: string
  created_at: string
}

export type Enrollment = {
  id: string
  user_id: string
  course_id: string
  credit_id: string | null
  enrolled_from_unit: number
  created_at: string
  course?: Course
}

export type Booking = {
  id: string
  user_id: string
  session_id: string
  credit_id: string | null
  type: 'course' | 'single'
  status: 'active' | 'cancelled'
  cancelled_at: string | null
  cancel_late: boolean
  created_at: string
  session?: Session
}

export type Waitlist = {
  id: string
  user_id: string
  session_id: string
  type: 'waitlist' | 'notify'
  position: number | null
  created_at: string
  session?: Session
}

export type Invitation = {
  id: string
  token: string
  email: string
  first_name: string | null
  last_name: string | null
  course_id: string | null
  credits_to_assign: number | null
  used: boolean
  created_at: string
  expires_at: string
  course?: Course
}

export type AuditLog = {
  id: string
  user_id: string | null
  action: string
  details: Record<string, unknown> | null
  created_at: string
  profile?: Profile
}

// Badge-Status für "Meine" Seite
export type BookingStatus = 'angemeldet' | 'teilgenommen' | 'ausgetragen'

export function getBookingStatus(booking: Booking): BookingStatus {
  if (booking.status === 'cancelled') return 'ausgetragen'
  const sessionDate = booking.session?.date
  if (sessionDate && new Date(sessionDate) < new Date()) return 'teilgenommen'
  return 'angemeldet'
}
