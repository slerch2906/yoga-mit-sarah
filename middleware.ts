import { NextResponse, type NextRequest } from 'next/server'

// Middleware nur als Pass-through - Session-Schutz läuft über
// die einzelnen Seiten selbst (getCurrentUser() checks)
// Die Middleware-Auth-Check-Variante hat Login-Loop verursacht

export async function middleware(request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: []
}
