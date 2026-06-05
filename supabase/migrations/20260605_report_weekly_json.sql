-- Wochenbericht (Sarah 2026-06-05): rein lesende Report-Datenfunktion.
-- Additiv, greift NICHT in bestehende App-Logik ein, schreibt nichts (nur SELECT).
-- Liefert alle 5 Datensaetze als JSON fuer die Edge-Funktion wochenbericht-export.
-- Auf Staging + Prod angewandt.
CREATE OR REPLACE FUNCTION public.report_weekly_json()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
WITH t AS (SELECT (now() AT TIME ZONE 'Europe/Berlin')::date AS d),
cs AS (
  SELECT s.id AS session_id, s.course_id, s.date FROM sessions s
  WHERE coalesce(s.session_type,'course_session')='course_session'
)
SELECT jsonb_build_object(
  'stand', (SELECT to_char(d,'DD.MM.YYYY') FROM t),
  'kurse', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', p.first_name||' '||p.last_name, 'kurs', c.name, 'tag', c.weekday,
      'uhr', to_char(c.time_start,'HH24:MI'),
      'zeitraum', to_char(c.date_start,'DD.MM.YY')||'-'||to_char(c.date_end,'DD.MM.YY'),
      'gesamt', coalesce(cr.total,0),
      'teilgenommen', (SELECT count(*) FROM bookings b JOIN cs ON cs.session_id=b.session_id WHERE b.user_id=e.user_id AND cs.course_id=c.id AND b.status='active' AND cs.date < (SELECT d FROM t)),
      'rechtzeitig', (SELECT count(*) FROM bookings b JOIN cs ON cs.session_id=b.session_id WHERE b.user_id=e.user_id AND cs.course_id=c.id AND b.status='cancelled' AND coalesce(b.cancel_late,false)=false),
      'zuspaet', (SELECT count(*) FROM bookings b JOIN cs ON cs.session_id=b.session_id WHERE b.user_id=e.user_id AND cs.course_id=c.id AND b.status='cancelled' AND b.cancel_late=true),
      'vorgezogen', (SELECT count(*) FROM bookings b JOIN sessions ms ON ms.id=b.session_id JOIN sessions os ON os.id=b.origin_session_id WHERE b.user_id=e.user_id AND b.status='active' AND os.course_id=c.id AND ms.date <  os.date),
      'nachgeholt', (SELECT count(*) FROM bookings b JOIN sessions ms ON ms.id=b.session_id JOIN sessions os ON os.id=b.origin_session_id WHERE b.user_id=e.user_id AND b.status='active' AND os.course_id=c.id AND ms.date >= os.date),
      'offen', (SELECT count(*) FROM bookings b JOIN cs ON cs.session_id=b.session_id WHERE b.user_id=e.user_id AND cs.course_id=c.id AND cs.date >= (SELECT d FROM t) AND b.status IN ('active','cancelled')),
      'angemeldet', (SELECT count(*) FROM bookings b JOIN cs ON cs.session_id=b.session_id WHERE b.user_id=e.user_id AND cs.course_id=c.id AND cs.date >= (SELECT d FROM t) AND b.status='active'),
      'abgemeldet', (SELECT count(*) FROM bookings b JOIN cs ON cs.session_id=b.session_id WHERE b.user_id=e.user_id AND cs.course_id=c.id AND cs.date >= (SELECT d FROM t) AND b.status='cancelled'),
      'frei', coalesce(cr.total,0)-coalesce(cr.used,0),
      'gueltig', coalesce(to_char(cr.expires_at,'DD.MM.YY'),'')
    ) ORDER BY c.name, p.last_name, p.first_name), '[]'::jsonb)
    FROM enrollments e JOIN profiles p ON p.id=e.user_id JOIN courses c ON c.id=e.course_id
    LEFT JOIN LATERAL (SELECT sum(total) total, sum(used) used, max(expires_at) expires_at FROM credits WHERE user_id=e.user_id AND course_id=c.id AND model='course') cr ON true
    WHERE coalesce(c.is_single,false)=false AND coalesce(c.is_system_container,false)=false AND p.is_admin=false AND coalesce(p.is_dummy,false)=false
  ),
  'guthaben', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', p.first_name||' '||p.last_name,
      'art', CASE cr.model WHEN 'tenpack' THEN 'Punktekarte' WHEN 'guthaben' THEN 'Guthaben' ELSE cr.model END,
      'gesamt', cr.total, 'genutzt', cr.used, 'frei', cr.total-cr.used,
      'herkunft', coalesce(cr.source,''), 'aus_kurs', coalesce(cr.source_course_name,''),
      'gueltig', to_char(cr.expires_at,'DD.MM.YY')
    ) ORDER BY cr.model, p.last_name), '[]'::jsonb)
    FROM credits cr JOIN profiles p ON p.id=cr.user_id
    WHERE cr.model IN ('tenpack','guthaben') AND p.is_admin=false AND coalesce(p.is_dummy,false)=false
  ),
  'kal_dates', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('kurs', c.name, 'tag', c.weekday, 'uhr', to_char(c.time_start,'HH24:MI'),
      'dates', (SELECT string_agg(to_char(s.date,'DD.MM.'), '|' ORDER BY s.date, s.id) FROM sessions s WHERE s.course_id=c.id AND coalesce(s.session_type,'course_session')='course_session')
    ) ORDER BY c.name), '[]'::jsonb)
    FROM courses c WHERE coalesce(c.is_single,false)=false AND coalesce(c.is_system_container,false)=false
  ),
  'kal_rows', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('kurs', c.name, 'name', p.first_name||' '||p.last_name,
      'stati', (SELECT string_agg(
        CASE WHEN s.is_cancelled THEN 'X' WHEN b.id IS NULL THEN '-'
             WHEN b.status='active' AND s.date < (SELECT d FROM t) THEN 'T'
             WHEN b.status='active' THEN 'A'
             WHEN b.status='cancelled' AND b.cancel_late THEN 'S'
             WHEN b.status='cancelled' THEN 'R' ELSE '?' END, '|' ORDER BY s.date, s.id)
        FROM sessions s LEFT JOIN bookings b ON b.user_id=e.user_id AND b.session_id=s.id
        WHERE s.course_id=c.id AND coalesce(s.session_type,'course_session')='course_session')
    ) ORDER BY c.name, p.last_name, p.first_name), '[]'::jsonb)
    FROM enrollments e JOIN profiles p ON p.id=e.user_id JOIN courses c ON c.id=e.course_id
    WHERE coalesce(c.is_single,false)=false AND coalesce(c.is_system_container,false)=false AND p.is_admin=false AND coalesce(p.is_dummy,false)=false
  ),
  'vorhol', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'yogi', p.first_name||' '||p.last_name,
      'art', CASE WHEN ms.date < os.date THEN 'Vorgeholt' ELSE 'Nachgeholt' END,
      'ersatz_am', to_char(ms.date,'DD.MM.YY'), 'ersatz_uhr', to_char(ms.time_start,'HH24:MI'),
      'was', coalesce(ms.name, mc.name, '—'), 'ersetzt', to_char(os.date,'DD.MM.YY'),
      'kurs', coalesce(oc.name,'—')
    ) ORDER BY p.last_name, ms.date), '[]'::jsonb)
    FROM bookings b JOIN profiles p ON p.id=b.user_id
    JOIN sessions ms ON ms.id=b.session_id LEFT JOIN courses mc ON mc.id=ms.course_id
    JOIN sessions os ON os.id=b.origin_session_id LEFT JOIN courses oc ON oc.id=os.course_id
    WHERE b.status='active' AND b.origin_session_id IS NOT NULL AND p.is_admin=false AND coalesce(p.is_dummy,false)=false
  ),
  'events', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'event', coalesce(nullif(s.name,''), c.name, 'Event'),
      'datum', to_char(s.date,'DD.MM.YY'), 'uhr', to_char(s.time_start,'HH24:MI'),
      'typ', CASE s.session_type WHEN 'event_free' THEN 'Kostenlos' WHEN 'event_paid' THEN coalesce(s.price_eur::text,'?')||' EUR' END,
      'yogi', p.first_name||' '||p.last_name, 'status', b.status
    ) ORDER BY s.date, p.last_name), '[]'::jsonb)
    FROM sessions s JOIN bookings b ON b.session_id=s.id JOIN profiles p ON p.id=b.user_id
    LEFT JOIN courses c ON c.id=s.course_id
    WHERE s.session_type IN ('event_free','event_paid') AND p.is_admin=false AND coalesce(p.is_dummy,false)=false
  )
);
$$;
