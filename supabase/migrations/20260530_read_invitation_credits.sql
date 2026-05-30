-- Bug-Fix (Sarah 2026-05-30, Live-Test): Einladung + direkte Kursbuchung
-- ----------------------------------------------------------------------------
-- Die Register-Seite (app/register/page.tsx) bucht den eingeladenen Yogi nach
-- der Registrierung NUR dann in den Kurs, wenn `invitation.course_id` UND
-- `invitation.credits_to_assign` gesetzt sind:
--     if (invitation?.course_id && invitation?.credits_to_assign) { … enroll … }
--
-- Der Welle-S1-Refactor stellte das Lesen der Einladung auf die SECURITY-DEFINER-
-- RPC `read_invitation_by_token` um — deren RETURNS TABLE vergaß aber die Spalten
-- `credits_to_assign` (und `course_total_units`). Dadurch war credits_to_assign im
-- Frontend immer undefined → Bedingung false → KEIN Enrollment, KEINE Buchungen.
-- Der Admin musste den Yogi nach der Registrierung manuell nachbuchen.
--
-- Fix: beide Spalten in die RPC aufnehmen (rein additiv, keine Logikänderung).
-- Da sich die RETURNS-TABLE-Signatur ändert, muss die Funktion zuerst gedroppt
-- werden (CREATE OR REPLACE kann den Rückgabetyp nicht ändern). Grants werden
-- danach neu gesetzt (Register-Seite ruft die RPC als anon auf, vor dem Login).
DROP FUNCTION IF EXISTS public.read_invitation_by_token(text);

CREATE FUNCTION public.read_invitation_by_token(p_token text)
 RETURNS TABLE(
   id uuid, token text, email text, first_name text, last_name text,
   course_id uuid, course_name text, course_total_units integer,
   credits_to_assign integer,
   used boolean, expires_at timestamp with time zone, created_at timestamp with time zone
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    i.id, i.token, i.email, i.first_name, i.last_name,
    i.course_id, c.name AS course_name, c.total_units AS course_total_units,
    i.credits_to_assign,
    i.used, i.expires_at, i.created_at
  FROM invitations i
  LEFT JOIN courses c ON c.id = i.course_id
  WHERE i.token = p_token
    AND (i.expires_at IS NULL OR i.expires_at > now())
  LIMIT 1;
$function$;

-- Grants: anon + authenticated (wie zuvor) + service_role (Backend/Tests), NICHT PUBLIC.
REVOKE ALL ON FUNCTION public.read_invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_invitation_by_token(text) TO anon, authenticated, service_role;
