-- Migration (Sarah 2026-05-29): Akteur einer Booking-Stornierung festhalten.
--
-- HINTERGRUND / PRODUKT-ENTSCHEID (Sarah 2026-05-29):
--   "Abgemeldet" und "Ausgetragen" waren bisher DERSELBE Datenbank-Zustand
--   (bookings.status = 'cancelled') und unterschieden sich nur nach BILDSCHIRM:
--   /meine + Admin-Kalender zeigten "Abgemeldet", Admin-Buchungsliste +
--   Dashboard "Ausgetragen". Sarah moechte die Woerter NACH AKTEUR vergeben:
--     - Yogi hat sich selbst abgemeldet        -> "Abgemeldet"
--     - Sarah/Admin hat den Yogi ausgetragen   -> "Ausgetragen"
--     - Die ganze Stunde wurde abgesagt        -> "Abgesagt"  (hat Vorrang)
--   Der Akteur stand bisher NUR im Protokoll (audit_log), nicht an der Buchung.
--
-- FIX (rein additiv - KEINE Logik-/Architektur-Aenderung):
--   Neue, NULL-bare Spalte bookings.cancelled_by ('self' | 'admin').
--     - Aktive Buchungen:        NULL
--     - Selbst-Abmeldung:        'self'   (App setzt es ab sofort)
--     - Admin-Austrag:           'admin'  (App setzt es ab sofort)
--   Anzeige faellt bei NULL auf "Abgemeldet" zurueck (haeufigster, am wenigsten
--   missverstaendlicher Default). Session-Absage (sessions.is_cancelled) hat in
--   der Anzeige IMMER Vorrang -> "Abgesagt", unabhaengig von cancelled_by.
--
--   Kein Trigger, keine RPC, kein bestehender Workflow wird veraendert.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancelled_by text
  CHECK (cancelled_by IS NULL OR cancelled_by IN ('self','admin'));

COMMENT ON COLUMN public.bookings.cancelled_by IS
  'Wer hat storniert: self=Yogi selbst (Anzeige "Abgemeldet"), admin=von Sarah/Admin ausgetragen (Anzeige "Ausgetragen"). NULL=aktive Buchung oder Altbestand ohne ableitbare Herkunft. Session-Absage (sessions.is_cancelled) hat in der Anzeige IMMER Vorrang ("Abgesagt").';

-- ── Best-Effort-Backfill aus dem Protokoll (audit_log) ───────────────────────
-- Nur status='cancelled' & cancelled_by IS NULL werden gesetzt; Unbekanntes
-- bleibt NULL. Text-Vergleich (kein ::uuid-Cast) -> robust gegen evtl. Nicht-
-- UUID-Details. Reihenfolge: Admin-Faelle zuerst, dann Selbst-Abmeldung fuellt
-- nur noch verbliebene NULLs.

-- 1) Admin-Austrag einzelner Buchungen: booking_cancelled_by_admin
UPDATE public.bookings b
SET cancelled_by = 'admin'
WHERE b.status = 'cancelled' AND b.cancelled_by IS NULL
  AND EXISTS (
    SELECT 1 FROM public.audit_log a
    WHERE a.action = 'booking_cancelled_by_admin'
      AND a.details->>'session_id' = b.session_id::text
      AND COALESCE(a.details->>'target_user_id', a.details->>'user_id') = b.user_id::text
  );

-- 2) Kurs-Austrag (Krankheit/Entfernung): yogi_removed_from_course (nur course_id)
UPDATE public.bookings b
SET cancelled_by = 'admin'
WHERE b.status = 'cancelled' AND b.cancelled_by IS NULL
  AND EXISTS (
    SELECT 1 FROM public.audit_log a
    JOIN public.sessions s ON s.course_id::text = a.details->>'course_id'
    WHERE a.action = 'yogi_removed_from_course'
      AND a.details->>'target_user_id' = b.user_id::text
      AND s.id = b.session_id
  );

-- 3) Selbst-Abmeldung: booking_cancelled (user_id = Yogi, details.session_id)
UPDATE public.bookings b
SET cancelled_by = 'self'
WHERE b.status = 'cancelled' AND b.cancelled_by IS NULL
  AND EXISTS (
    SELECT 1 FROM public.audit_log a
    WHERE a.action = 'booking_cancelled'
      AND a.user_id = b.user_id
      AND a.details->>'session_id' = b.session_id::text
  );
