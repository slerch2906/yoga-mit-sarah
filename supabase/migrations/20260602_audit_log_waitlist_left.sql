-- Sarah 2026-06-02: Selbst-Austragen von der Warteliste (Unsubscribe-Link)
-- protokollieren. Vorher schrieb leave_waitlist_by_token kein audit_log -> diese
-- Yogi-Aktivitaet fehlte im Protokoll. user_id = Yogi aus der Wartelisten-Zeile
-- (Link funktioniert ohne Login, daher kein auth.uid()). Auf Staging angewandt;
-- Prod folgt nach Freigabe.
CREATE OR REPLACE FUNCTION public.leave_waitlist_by_token(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_type text;
  v_course_name text;
  v_session_name text;
  v_session_type text;
  v_date date;
  v_time_start time;
  v_user_id uuid;
  v_session_id uuid;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token');
  END IF;

  SELECT w.type, s.date, s.time_start, c.name, s.name, s.session_type, w.user_id, s.id
    INTO v_type, v_date, v_time_start, v_course_name, v_session_name, v_session_type, v_user_id, v_session_id
  FROM waitlist w
  JOIN sessions s ON s.id = w.session_id
  JOIN courses c ON c.id = s.course_id
  WHERE w.unsubscribe_token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_removed');
  END IF;

  DELETE FROM waitlist WHERE unsubscribe_token = p_token;

  INSERT INTO audit_log (user_id, action, details)
  VALUES (v_user_id, 'waitlist_left', jsonb_build_object(
    'session_id', v_session_id,
    'session_date', v_date,
    'session_time', v_time_start,
    'course_name', v_course_name,
    'session_type', v_session_type,
    'via', 'unsubscribe_link'
  ));

  RETURN jsonb_build_object(
    'ok', true,
    'type', v_type,
    'course_name', v_course_name,
    'session_name', v_session_name,
    'session_type', v_session_type,
    'date', v_date,
    'time_start', v_time_start
  );
END;
$function$;
