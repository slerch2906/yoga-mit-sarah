-- ============================================================================
-- BASELINE-SCHEMA (aus Prod jcczvyablgdijeiyymhc extrahiert, 2026-05-31)
-- Vollstaendiges public-Schema: Tabellen, Constraints, Indizes, Funktionen,
-- Trigger, RLS-Policies, Grants. Reproduziert eine frische Umgebung (Staging).
-- ============================================================================

SET check_function_bodies = off;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.admin_notifications (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  type text NOT NULL,
  message text NOT NULL,
  details jsonb,
  read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.agb_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  label text NOT NULL,
  changelog text NOT NULL,
  sort_order integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_log (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  action text NOT NULL,
  details jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.bookings (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  credit_id uuid,
  type text NOT NULL DEFAULT 'course'::text,
  status text NOT NULL DEFAULT 'active'::text,
  cancelled_at timestamp with time zone,
  cancel_late boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  origin_session_id uuid,
  promoted_at timestamp with time zone,
  cancelled_by text
);

CREATE TABLE public.course_cancellation_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  course_id uuid,
  user_id uuid,
  token text NOT NULL,
  choice text,
  refund_paid boolean DEFAULT false,
  credits_issued boolean DEFAULT false,
  expires_at timestamp with time zone NOT NULL,
  remaining_sessions integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  responded_at timestamp with time zone,
  guthaben_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  new_credits_count integer NOT NULL DEFAULT 0,
  provisional_credit_id uuid
);

CREATE TABLE public.courses (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  weekday text NOT NULL,
  time_start time without time zone NOT NULL,
  duration_min integer NOT NULL,
  location text,
  description text,
  bring_along text,
  difficulty text,
  max_spots integer NOT NULL,
  total_units integer NOT NULL,
  date_start date NOT NULL,
  date_end date NOT NULL,
  is_active boolean DEFAULT true,
  is_single boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  is_cancelled boolean DEFAULT false,
  cancel_reason text,
  cancelled_at timestamp with time zone,
  is_open boolean DEFAULT false,
  is_free boolean NOT NULL DEFAULT false,
  image_url text,
  is_system_container boolean NOT NULL DEFAULT false
);

CREATE TABLE public.credits (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  course_id uuid,
  model text NOT NULL,
  total integer NOT NULL,
  used integer DEFAULT 0,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  valid_from date,
  source text,
  source_course_name text
);

CREATE TABLE public.enrollments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  course_id uuid NOT NULL,
  credit_id uuid,
  enrolled_from_unit integer DEFAULT 1,
  created_at timestamp with time zone DEFAULT now(),
  enrolled_until_unit integer,
  end_date date,
  end_reason text
);

CREATE TABLE public.admin_announcement (
  id integer NOT NULL DEFAULT 1,
  message text NOT NULL DEFAULT ''::text,
  is_active boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  update_banner_version text,
  update_banner_set_at timestamp with time zone,
  link_url text,
  link_label text
);

CREATE TABLE public.legal_acceptances (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  version text NOT NULL DEFAULT '2025-12'::text,
  accepted_at timestamp with time zone DEFAULT now(),
  ip_hint text,
  full_name text,
  birth_date date,
  phone text,
  emergency_contact text,
  ip_address text,
  user_agent text,
  haftung_text text,
  agb_version text DEFAULT '2025-12'::text
);

CREATE TABLE public.notification_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  type text NOT NULL,
  sent_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  is_admin boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  legal_accepted_at timestamp with time zone,
  legal_version text,
  is_dummy boolean DEFAULT false,
  emergency_name text,
  emergency_phone text,
  notify_booking_confirmations boolean DEFAULT true,
  notify_waitlist_joined boolean DEFAULT true,
  notify_session_reminder_hours integer,
  agb_version integer NOT NULL DEFAULT 1,
  recovery_backup jsonb,
  recovery_expires_at timestamp with time zone,
  onboarding_completed boolean NOT NULL DEFAULT false,
  birthdate date
);

CREATE TABLE public.sessions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  course_id uuid NOT NULL,
  date date NOT NULL,
  time_start time without time zone NOT NULL,
  duration_min integer NOT NULL,
  is_cancelled boolean DEFAULT false,
  cancel_reason text,
  replacement_session_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  external_participants_count integer NOT NULL DEFAULT 0,
  session_type text NOT NULL DEFAULT 'course_session'::text,
  price_eur numeric(10,2),
  name text,
  location text,
  description text,
  max_spots integer,
  image_url text,
  bring_along text,
  difficulty text,
  is_open boolean DEFAULT true
);

CREATE TABLE public.waitlist (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'waitlist'::text,
  "position" integer,
  created_at timestamp with time zone DEFAULT now(),
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid()
);

CREATE TABLE public.waitlist_offers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'::text),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  claimed_at timestamp with time zone,
  resolved_winner_user_id uuid
);

CREATE TABLE public.yogi_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dismissed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.invitations (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'::text),
  email text NOT NULL,
  first_name text,
  last_name text,
  course_id uuid,
  credits_to_assign integer,
  used boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone DEFAULT (now() + '14 days'::interval),
  accepted_at timestamp with time zone
);

ALTER TABLE waitlist ADD CONSTRAINT waitlist_pkey PRIMARY KEY (id);

ALTER TABLE yogi_notifications ADD CONSTRAINT yogi_notifications_pkey PRIMARY KEY (id);

ALTER TABLE admin_announcement ADD CONSTRAINT admin_announcement_pkey PRIMARY KEY (id);

ALTER TABLE agb_versions ADD CONSTRAINT agb_versions_pkey PRIMARY KEY (id);

ALTER TABLE waitlist_offers ADD CONSTRAINT waitlist_offers_pkey PRIMARY KEY (id);

ALTER TABLE notification_log ADD CONSTRAINT notification_log_pkey PRIMARY KEY (id);

ALTER TABLE course_cancellation_responses ADD CONSTRAINT course_cancellation_responses_pkey PRIMARY KEY (id);

ALTER TABLE admin_notifications ADD CONSTRAINT admin_notifications_pkey PRIMARY KEY (id);

ALTER TABLE legal_acceptances ADD CONSTRAINT legal_acceptances_pkey PRIMARY KEY (id);

ALTER TABLE audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

ALTER TABLE invitations ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);

ALTER TABLE bookings ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);

ALTER TABLE enrollments ADD CONSTRAINT enrollments_pkey PRIMARY KEY (id);

ALTER TABLE credits ADD CONSTRAINT credits_pkey PRIMARY KEY (id);

ALTER TABLE sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

ALTER TABLE courses ADD CONSTRAINT courses_pkey PRIMARY KEY (id);

ALTER TABLE profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

ALTER TABLE course_cancellation_responses ADD CONSTRAINT course_cancellation_responses_token_key UNIQUE (token);

ALTER TABLE notification_log ADD CONSTRAINT notification_log_user_id_session_id_type_key UNIQUE (user_id, session_id, type);

ALTER TABLE bookings ADD CONSTRAINT bookings_user_id_session_id_key UNIQUE (user_id, session_id);

ALTER TABLE enrollments ADD CONSTRAINT enrollments_user_id_course_id_key UNIQUE (user_id, course_id);

ALTER TABLE waitlist ADD CONSTRAINT waitlist_user_id_session_id_key UNIQUE (user_id, session_id);

ALTER TABLE invitations ADD CONSTRAINT invitations_token_key UNIQUE (token);

ALTER TABLE waitlist_offers ADD CONSTRAINT waitlist_offers_token_key UNIQUE (token);

ALTER TABLE waitlist_offers ADD CONSTRAINT waitlist_offers_session_id_user_id_key UNIQUE (session_id, user_id);

ALTER TABLE sessions ADD CONSTRAINT sessions_max_spots_check CHECK (((max_spots IS NULL) OR (max_spots > 0)));

ALTER TABLE sessions ADD CONSTRAINT sessions_session_type_check CHECK ((session_type = ANY (ARRAY['course_session'::text, 'single'::text, 'event_free'::text, 'event_paid'::text])));

ALTER TABLE bookings ADD CONSTRAINT bookings_cancelled_by_check CHECK (((cancelled_by IS NULL) OR (cancelled_by = ANY (ARRAY['self'::text, 'admin'::text]))));

ALTER TABLE sessions ADD CONSTRAINT sessions_external_participants_count_check CHECK ((external_participants_count >= 0));

ALTER TABLE sessions ADD CONSTRAINT sessions_price_eur_check CHECK (((price_eur IS NULL) OR (price_eur > (0)::numeric)));

ALTER TABLE sessions ADD CONSTRAINT sessions_price_only_for_paid_events CHECK ((((session_type = 'event_paid'::text) AND (price_eur IS NOT NULL)) OR ((session_type <> 'event_paid'::text) AND (price_eur IS NULL)))) NOT VALID;

ALTER TABLE admin_announcement ADD CONSTRAINT admin_announcement_id_check CHECK ((id = 1));

ALTER TABLE enrollments ADD CONSTRAINT enrollments_credit_id_fkey FOREIGN KEY (credit_id) REFERENCES credits(id);

ALTER TABLE enrollments ADD CONSTRAINT enrollments_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;

ALTER TABLE enrollments ADD CONSTRAINT enrollments_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE waitlist_offers ADD CONSTRAINT waitlist_offers_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

ALTER TABLE bookings ADD CONSTRAINT bookings_origin_session_id_fkey FOREIGN KEY (origin_session_id) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE course_cancellation_responses ADD CONSTRAINT course_cancellation_responses_provisional_credit_id_fkey FOREIGN KEY (provisional_credit_id) REFERENCES credits(id) ON DELETE SET NULL;

ALTER TABLE notification_log ADD CONSTRAINT notification_log_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

ALTER TABLE notification_log ADD CONSTRAINT notification_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE course_cancellation_responses ADD CONSTRAINT course_cancellation_responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);

ALTER TABLE course_cancellation_responses ADD CONSTRAINT course_cancellation_responses_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id);

ALTER TABLE legal_acceptances ADD CONSTRAINT legal_acceptances_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE audit_log ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE invitations ADD CONSTRAINT invitations_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id);

ALTER TABLE waitlist ADD CONSTRAINT waitlist_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

ALTER TABLE waitlist ADD CONSTRAINT waitlist_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE bookings ADD CONSTRAINT bookings_credit_id_fkey FOREIGN KEY (credit_id) REFERENCES credits(id);

ALTER TABLE bookings ADD CONSTRAINT bookings_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

ALTER TABLE bookings ADD CONSTRAINT bookings_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE credits ADD CONSTRAINT credits_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id);

ALTER TABLE credits ADD CONSTRAINT credits_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE sessions ADD CONSTRAINT sessions_replacement_session_id_fkey FOREIGN KEY (replacement_session_id) REFERENCES sessions(id);

ALTER TABLE sessions ADD CONSTRAINT sessions_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;

ALTER TABLE profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE yogi_notifications ADD CONSTRAINT yogi_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE waitlist_offers ADD CONSTRAINT waitlist_offers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX idx_audit_log_created_at_desc ON public.audit_log USING btree (created_at DESC);

CREATE INDEX idx_waitlist_offers_session ON public.waitlist_offers USING btree (session_id);

CREATE INDEX yogi_notifications_user_open_idx ON public.yogi_notifications USING btree (user_id, dismissed_at) WHERE (dismissed_at IS NULL);

CREATE UNIQUE INDEX idx_agb_versions_sort_order ON public.agb_versions USING btree (sort_order);

CREATE INDEX idx_admin_notifications_unread ON public.admin_notifications USING btree (created_at DESC) WHERE (read = false);

CREATE INDEX idx_audit_log_details_gin ON public.audit_log USING gin (details);

CREATE UNIQUE INDEX waitlist_unsubscribe_token_unique ON public.waitlist USING btree (unsubscribe_token);

CREATE INDEX idx_courses_is_system_container ON public.courses USING btree (is_system_container) WHERE (is_system_container = true);

CREATE INDEX idx_audit_log_user_id ON public.audit_log USING btree (user_id) WHERE (user_id IS NOT NULL);

CREATE INDEX idx_bookings_origin_session_id ON public.bookings USING btree (origin_session_id) WHERE (origin_session_id IS NOT NULL);

CREATE INDEX idx_waitlist_offers_token ON public.waitlist_offers USING btree (token);

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.available_spots(p_session_id uuid)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(s.max_spots, c.max_spots, 0)
       - COALESCE((SELECT COUNT(*)::int FROM bookings b WHERE b.session_id = s.id AND b.status = 'active'), 0)
  FROM sessions s
  LEFT JOIN courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_auth_user_on_profile_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM auth.users WHERE id = OLD.id;
  RETURN OLD;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_old_audit_logs()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from audit_log where created_at < now() - interval '24 months';
$function$
;

CREATE OR REPLACE FUNCTION public.available_credits(p_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(total - used), 0)::int
  from credits
  where user_id = p_user_id
    and expires_at > now()
    and (total - used) > 0;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND is_admin = true
  );
$function$
;

CREATE OR REPLACE FUNCTION public.fn_notify_admin_new_yogi()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Nur fuer NEUE Profile (INSERT) und nur fuer Yogis (kein Admin, kein Dummy)
  IF NEW.is_admin = true OR NEW.is_dummy = true THEN
    RETURN NEW;
  END IF;

  -- Dedup: pro user_id nur EINE new_yogi_registered-Notification jemals
  -- (verhindert Doppel-Inserts, falls der App-Code in /register ebenfalls noch einfuegt)
  IF EXISTS (
    SELECT 1 FROM admin_notifications
    WHERE type = 'new_yogi_registered'
    AND details->>'user_id' = NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO admin_notifications (type, message, details, read)
  VALUES (
    'new_yogi_registered',
    COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '') ||
      ' (' || COALESCE(NEW.email, 'keine Email') || ') hat sich erfolgreich registriert.',
    jsonb_build_object('user_id', NEW.id, 'email', NEW.email),
    false
  );

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.consume_invitation_by_token(p_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invitation_email text;
  v_user_email text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT email INTO v_invitation_email
  FROM invitations
  WHERE token = p_token AND used = false
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;
  IF v_invitation_email IS NULL THEN RETURN false; END IF;
  SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();
  IF lower(v_user_email) <> lower(v_invitation_email) THEN RETURN false; END IF;
  UPDATE invitations SET used = true, accepted_at = now()
  WHERE token = p_token AND used = false;
  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.read_cancellation_response_by_token(p_token text)
 RETURNS TABLE(id uuid, token text, user_id uuid, course_id uuid, course_name text, choice text, remaining_sessions integer, expires_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    r.id, r.token, r.user_id, r.course_id, c.name AS course_name,
    r.choice, r.remaining_sessions, r.expires_at, r.created_at
  FROM course_cancellation_responses r
  LEFT JOIN courses c ON c.id = r.course_id
  WHERE r.token = p_token
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_cancellation_refund(p_response_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_breakdown jsonb;
  v_item jsonb;
  v_credit_id uuid;
  v_count integer;
BEGIN
  SELECT guthaben_breakdown INTO v_breakdown
  FROM course_cancellation_responses WHERE id = p_response_id;
  IF v_breakdown IS NULL THEN RETURN; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_breakdown)
  LOOP
    v_credit_id := (v_item->>'credit_id')::uuid;
    v_count := (v_item->>'count')::integer;
    IF v_credit_id IS NOT NULL AND v_count > 0 THEN
      -- total um count reduzieren; mindestens 0, mindestens used (damit free nicht negativ wird)
      UPDATE credits
        SET total = GREATEST(used, total - v_count)
        WHERE id = v_credit_id;
    END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_session_max_spots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_max_spots integer;
  v_current_active integer;
  v_caller_is_admin boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_caller_is_admin
  FROM profiles WHERE id = auth.uid();
  IF v_caller_is_admin THEN
    RETURN NEW;
  END IF;

  -- Welle 2.11: session.max_spots Vorrang (Events/Einzelstunden), Fallback course.
  SELECT COALESCE(s.max_spots, c.max_spots) INTO v_max_spots
  FROM sessions s
  LEFT JOIN courses c ON c.id = s.course_id
  WHERE s.id = NEW.session_id;

  IF v_max_spots IS NULL OR v_max_spots = 0 THEN
    -- Kein Limit gesetzt → durchlassen
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_current_active
  FROM bookings
  WHERE session_id = NEW.session_id
    AND status = 'active';

  IF v_current_active >= v_max_spots THEN
    RAISE EXCEPTION 'Session ist ausgebucht (max_spots=%, aktiv=%)', v_max_spots, v_current_active
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.join_waitlist(p_session_id uuid, p_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_count integer;
  v_position integer;
  v_token uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Nicht authentifiziert';
  END IF;

  IF p_type NOT IN ('waitlist', 'notify') THEN
    RAISE EXCEPTION 'Ungültiger Typ';
  END IF;

  IF p_type = 'notify' THEN
    INSERT INTO waitlist (user_id, session_id, type, position)
    VALUES (v_caller, p_session_id, 'notify', NULL)
    RETURNING unsubscribe_token INTO v_token;
    RETURN jsonb_build_object('type', 'notify', 'position', null, 'unsubscribe_token', v_token);
  END IF;

  -- waitlist: Position bestimmen
  SELECT COUNT(*) INTO v_count
  FROM waitlist WHERE session_id = p_session_id AND type = 'waitlist';
  v_position := v_count + 1;

  INSERT INTO waitlist (user_id, session_id, type, position)
  VALUES (v_caller, p_session_id, 'waitlist', v_position)
  RETURNING unsubscribe_token INTO v_token;

  RETURN jsonb_build_object('type', 'waitlist', 'position', v_position, 'unsubscribe_token', v_token);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_invitation_enrollment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inv RECORD;
  invitation_token TEXT;
  last_session_date DATE;
  expiry_date TIMESTAMPTZ;
  actual_session_count INT;
  new_credit_id UUID;
BEGIN
  -- Token aus Auth User Metadata holen
  SELECT raw_user_meta_data->>'invitation_token' INTO invitation_token
  FROM auth.users WHERE id = NEW.id;

  IF invitation_token IS NULL THEN
    RETURN NEW;
  END IF;

  -- Einladung NUR über den spezifischen Token laden
  SELECT * INTO inv FROM invitations
  WHERE token = invitation_token
    AND course_id IS NOT NULL
    AND used = true;

  IF inv.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- IMMER echte zukünftige Sessions zählen (nicht credits_to_assign vom Admin)
  SELECT COUNT(*) INTO actual_session_count
  FROM sessions 
  WHERE course_id = inv.course_id
    AND date >= CURRENT_DATE
    AND is_cancelled = false;

  IF actual_session_count = 0 THEN
    RETURN NEW;
  END IF;

  -- Verfallsdatum: 8 Tage nach letzter Session
  SELECT MAX(date) INTO last_session_date
  FROM sessions WHERE course_id = inv.course_id AND is_cancelled = false;
  expiry_date := COALESCE((last_session_date + INTERVAL '8 days')::TIMESTAMPTZ, NOW() + INTERVAL '90 days');

  -- Credits vergeben: total = actual_session_count (echte zukünftige Sessions)
  INSERT INTO credits (user_id, course_id, model, total, used, expires_at)
  VALUES (NEW.id, inv.course_id, 'course', actual_session_count, actual_session_count, expiry_date)
  RETURNING id INTO new_credit_id;

  -- In Kurs einbuchen
  INSERT INTO enrollments (user_id, course_id, enrolled_from_unit)
  VALUES (NEW.id, inv.course_id, 1)
  ON CONFLICT (user_id, course_id) DO NOTHING;

  -- Alle zukünftigen Sessions buchen
  INSERT INTO bookings (user_id, session_id, credit_id, type, status)
  SELECT NEW.id, s.id, new_credit_id, 'course', 'active'
  FROM sessions s
  WHERE s.course_id = inv.course_id
    AND s.date >= CURRENT_DATE
    AND s.is_cancelled = false
  ON CONFLICT (user_id, session_id) DO NOTHING;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Anonymisierte Profile NIEMALS überschreiben
  -- Wenn Profil existiert und first_name = 'Gelöschter' → nicht anfassen
  IF EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = new.id AND first_name = 'Gelöschter'
  ) THEN
    RETURN new;
  END IF;

  INSERT INTO public.profiles (id, first_name, last_name, email, is_dummy)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'first_name', split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'last_name', ''),
    CASE WHEN (new.raw_user_meta_data->>'is_dummy')::boolean = true THEN null ELSE new.email END,
    COALESCE((new.raw_user_meta_data->>'is_dummy')::boolean, false)
  )
  ON CONFLICT (id) DO UPDATE SET
    email = CASE WHEN profiles.first_name = 'Gelöschter' THEN profiles.email ELSE EXCLUDED.email END,
    first_name = CASE WHEN profiles.first_name = 'Gelöschter' THEN profiles.first_name ELSE EXCLUDED.first_name END,
    last_name = CASE WHEN profiles.first_name = 'Gelöschter' THEN profiles.last_name ELSE EXCLUDED.last_name END,
    is_dummy = EXCLUDED.is_dummy;
  RETURN new;
EXCEPTION WHEN OTHERS THEN
  RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_booking_cancelled_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session_cancelled boolean;
BEGIN
  -- Nur active Bookings prüfen (cancelled bookings sind ok, das ist ja "Abmeldung")
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  SELECT is_cancelled INTO v_session_cancelled
  FROM sessions WHERE id = NEW.session_id;

  IF v_session_cancelled THEN
    RAISE EXCEPTION 'Diese Stunde wurde abgesagt – Buchung nicht möglich (auch nicht durch Admin).'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_course_total_units()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE courses SET total_units = (
    SELECT COUNT(*) FROM sessions 
    WHERE course_id = COALESCE(NEW.course_id, OLD.course_id)
    AND is_cancelled = false
  )
  WHERE id = COALESCE(NEW.course_id, OLD.course_id);
  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_credit_used_on_booking_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_credit_id uuid;
BEGIN
  -- credit_id der betroffenen booking finden (kann sich bei UPDATE ändern)
  IF TG_OP = 'DELETE' THEN
    v_credit_id := OLD.credit_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.credit_id IS DISTINCT FROM NEW.credit_id THEN
    -- credit_id hat sich geändert → beide neu berechnen
    IF OLD.credit_id IS NOT NULL THEN PERFORM recalc_credit_used(OLD.credit_id); END IF;
    v_credit_id := NEW.credit_id;
  ELSE
    v_credit_id := COALESCE(NEW.credit_id, OLD.credit_id);
  END IF;

  IF v_credit_id IS NOT NULL THEN
    PERFORM recalc_credit_used(v_credit_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_credits_on_session_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_credit_id uuid;
BEGIN
  IF NEW.is_cancelled IS DISTINCT FROM OLD.is_cancelled THEN
    FOR v_credit_id IN
      SELECT DISTINCT credit_id FROM bookings WHERE session_id = NEW.id AND credit_id IS NOT NULL
    LOOP
      PERFORM recalc_credit_used(v_credit_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_cancellation_with_waitlist(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_has_booking boolean;
  v_session record;
  v_waitlist record;
  v_credit record;
  v_is_event boolean;
  v_display_name text;
  v_promoted jsonb := null;
  v_notify_users jsonb := '[]'::jsonb;
  v_skipped_no_credit jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Nicht authentifiziert';
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin FROM profiles WHERE id = v_caller;

  SELECT EXISTS(SELECT 1 FROM bookings WHERE user_id = v_caller AND session_id = p_session_id)
    INTO v_has_booking;

  IF NOT v_is_admin AND NOT v_has_booking THEN
    RAISE EXCEPTION 'Nicht berechtigt für diese Session';
  END IF;

  SELECT s.id, s.date, s.time_start, s.session_type, s.name AS session_name, c.name AS course_name
    INTO v_session
  FROM sessions s
  LEFT JOIN courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  v_is_event := v_session.session_type IN ('event_free', 'event_paid');
  v_display_name := CASE
    WHEN v_is_event AND COALESCE(v_session.session_name, '') <> '' THEN v_session.session_name
    ELSE v_session.course_name
  END;

  IF v_is_event THEN
    FOR v_waitlist IN
      SELECT w.id AS waitlist_id, w.user_id, w.position, p.email, p.first_name
      FROM waitlist w
      JOIN profiles p ON p.id = w.user_id
      WHERE w.session_id = p_session_id AND w.type = 'waitlist'
      ORDER BY w.position ASC NULLS LAST, w.created_at ASC
      LIMIT 1
    LOOP
      INSERT INTO bookings (user_id, session_id, credit_id, type, status, cancelled_at, cancel_late, promoted_at)
      VALUES (v_waitlist.user_id, p_session_id, NULL, 'single', 'active', NULL, false, now())
      ON CONFLICT (user_id, session_id) DO UPDATE
        SET status = 'active', credit_id = NULL, cancelled_at = NULL, cancel_late = false, promoted_at = now();

      v_promoted := jsonb_build_object(
        'user_id', v_waitlist.user_id,
        'email', v_waitlist.email,
        'first_name', v_waitlist.first_name,
        'course_name', v_display_name,
        'session_type', v_session.session_type,
        'date', v_session.date,
        'time_start', v_session.time_start
      );

      DELETE FROM waitlist WHERE id = v_waitlist.waitlist_id;
    END LOOP;
  ELSE
    FOR v_waitlist IN
      SELECT w.id AS waitlist_id, w.user_id, w.position, p.email, p.first_name
      FROM waitlist w
      JOIN profiles p ON p.id = w.user_id
      WHERE w.session_id = p_session_id AND w.type = 'waitlist'
      ORDER BY w.position ASC NULLS LAST, w.created_at ASC
    LOOP
      SELECT id, used, total INTO v_credit
      FROM credits
      WHERE user_id = v_waitlist.user_id
        AND total > used
        AND expires_at > now()
        AND model <> 'guthaben'
      ORDER BY expires_at ASC
      LIMIT 1;

      IF v_credit.id IS NOT NULL THEN
        INSERT INTO bookings (user_id, session_id, credit_id, type, status, cancelled_at, cancel_late, promoted_at)
        VALUES (v_waitlist.user_id, p_session_id, v_credit.id, 'single', 'active', NULL, false, now())
        ON CONFLICT (user_id, session_id) DO UPDATE
          SET status = 'active', credit_id = v_credit.id, cancelled_at = NULL, cancel_late = false, promoted_at = now();

        v_promoted := jsonb_build_object(
          'user_id', v_waitlist.user_id,
          'email', v_waitlist.email,
          'first_name', v_waitlist.first_name,
          'course_name', v_display_name,
          'session_type', v_session.session_type,
          'date', v_session.date,
          'time_start', v_session.time_start
        );

        DELETE FROM waitlist WHERE id = v_waitlist.waitlist_id;
        EXIT;
      ELSE
        v_skipped_no_credit := v_skipped_no_credit || jsonb_build_object(
          'user_id', v_waitlist.user_id,
          'email', v_waitlist.email,
          'first_name', v_waitlist.first_name,
          'course_name', v_display_name,
          'date', v_session.date,
          'time_start', v_session.time_start
        );
        DELETE FROM waitlist WHERE id = v_waitlist.waitlist_id;
      END IF;
    END LOOP;
  END IF;

  IF v_promoted IS NOT NULL THEN
    BEGIN
      INSERT INTO audit_log (user_id, action, details)
      VALUES ((v_promoted->>'user_id')::uuid, 'waitlist_promoted', jsonb_build_object(
        'session_id', p_session_id,
        'course_name', v_promoted->>'course_name',
        'session_date', v_promoted->>'date', 'session_time', v_promoted->>'time_start',
        'session_type', v_promoted->>'session_type',
        'first_name', v_promoted->>'first_name'));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  IF v_promoted IS NULL THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'user_id', w.user_id,
        'email', p.email,
        'first_name', p.first_name,
        'course_name', v_display_name,
        'date', v_session.date,
        'time_start', v_session.time_start,
        'session_id', p_session_id
      )
    ), '[]'::jsonb) INTO v_notify_users
    FROM waitlist w
    JOIN profiles p ON p.id = w.user_id
    WHERE w.session_id = p_session_id AND w.type = 'notify';

    DELETE FROM waitlist WHERE session_id = p_session_id AND type = 'notify';
  END IF;

  RETURN jsonb_build_object(
    'promoted', v_promoted,
    'notify_users', v_notify_users,
    'skipped_no_credit', v_skipped_no_credit
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_notification_sent(p_user_id uuid, p_session_id uuid, p_type text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO notification_log (user_id, session_id, type) VALUES (p_user_id, p_session_id, p_type)
  ON CONFLICT (user_id, session_id, type) DO NOTHING;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalc_credit_used(p_credit_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_used integer;
BEGIN
  SELECT COUNT(*) INTO v_new_used
  FROM bookings b
  JOIN sessions s ON s.id = b.session_id
  WHERE b.credit_id = p_credit_id
    AND s.is_cancelled = false
    AND (
      b.status = 'active'
      OR (b.status = 'cancelled' AND b.cancel_late = true)
    );

  UPDATE credits SET used = v_new_used WHERE id = p_credit_id;
  RETURN v_new_used;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_session_booking_counts(p_session_ids uuid[])
 RETURNS TABLE(session_id uuid, booking_count integer, cancelled_count integer, external_count integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    s.id AS session_id,
    COALESCE((SELECT COUNT(*)::int FROM bookings b WHERE b.session_id = s.id AND b.status = 'active'), 0) AS booking_count,
    COALESCE((SELECT COUNT(*)::int FROM bookings b WHERE b.session_id = s.id AND b.status = 'cancelled'), 0) AS cancelled_count,
    COALESCE(s.external_participants_count, 0) AS external_count
  FROM sessions s
  WHERE s.id = ANY(p_session_ids);
$function$
;

CREATE OR REPLACE FUNCTION public.process_cancellation_full(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_has_booking boolean;
  v_session record;
  v_is_event boolean;
  v_promote_without_credit boolean;
  v_display_name text;
  v_start timestamptz;
  v_now timestamptz := now();
  v_within90 boolean;
  v_waitlist record;
  v_credit record;
  v_still_free int;
  v_other record;
  v_token text;
  v_winner_exists boolean;
  v_promoted jsonb := null;
  v_removed_elsewhere jsonb := '[]'::jsonb;
  v_offers jsonb := '[]'::jsonb;
  v_notify jsonb := '[]'::jsonb;
  v_mode text;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT COALESCE(is_admin, false) INTO v_is_admin FROM profiles WHERE id = v_caller;
    SELECT EXISTS(SELECT 1 FROM bookings WHERE user_id = v_caller AND session_id = p_session_id)
      INTO v_has_booking;
    IF NOT v_is_admin AND NOT v_has_booking THEN
      RAISE EXCEPTION 'Nicht berechtigt für diese Session';
    END IF;
  END IF;

  SELECT s.id, s.date, s.time_start, s.session_type, s.name AS session_name,
         s.course_id, s.is_cancelled, c.name AS course_name,
         COALESCE(c.is_free, false) AS is_free
    INTO v_session
  FROM sessions s
  LEFT JOIN courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL OR v_session.is_cancelled THEN
    RETURN jsonb_build_object('mode', 'noop');
  END IF;

  v_start := (v_session.date + v_session.time_start) AT TIME ZONE 'Europe/Berlin';
  IF v_start <= v_now THEN
    RETURN jsonb_build_object('mode', 'noop');
  END IF;

  v_is_event := v_session.session_type IN ('event_free', 'event_paid');
  v_promote_without_credit := v_is_event OR v_session.is_free;
  v_display_name := CASE
    WHEN (v_is_event OR v_session.session_type = 'single')
         AND COALESCE(v_session.session_name, '') <> '' THEN v_session.session_name
    ELSE v_session.course_name
  END;

  v_within90 := (v_start - v_now) <= interval '90 minutes';

  IF NOT v_within90 THEN
    FOR v_waitlist IN
      SELECT w.id AS waitlist_id, w.user_id, p.email, p.first_name
      FROM waitlist w
      JOIN profiles p ON p.id = w.user_id
      WHERE w.session_id = p_session_id AND w.type = 'waitlist'
      ORDER BY w.created_at ASC
    LOOP
      IF v_promote_without_credit THEN
        INSERT INTO bookings (user_id, session_id, credit_id, type, status, cancelled_at, cancel_late, promoted_at)
        VALUES (v_waitlist.user_id, p_session_id, NULL, 'single', 'active', NULL, false, now())
        ON CONFLICT (user_id, session_id) DO UPDATE
          SET status = 'active', credit_id = NULL, cancelled_at = NULL, cancel_late = false, promoted_at = now();
        DELETE FROM waitlist WHERE id = v_waitlist.waitlist_id;
        v_promoted := jsonb_build_object(
          'user_id', v_waitlist.user_id, 'email', v_waitlist.email, 'first_name', v_waitlist.first_name,
          'course_name', v_display_name, 'session_type', v_session.session_type,
          'date', v_session.date, 'time_start', v_session.time_start);
        EXIT;
      ELSE
        SELECT id, course_id, model INTO v_credit
        FROM credits
        WHERE user_id = v_waitlist.user_id
          AND total > used
          AND expires_at > now()
          AND model <> 'guthaben'
        ORDER BY (CASE WHEN model = 'course' AND v_session.course_id IS NOT NULL
                            AND course_id = v_session.course_id THEN 0 ELSE 1 END),
                 expires_at ASC
        LIMIT 1;
        IF v_credit.id IS NULL THEN
          CONTINUE;
        END IF;
        INSERT INTO bookings (user_id, session_id, credit_id, type, status, cancelled_at, cancel_late, promoted_at)
        VALUES (v_waitlist.user_id, p_session_id, v_credit.id, 'single', 'active', NULL, false, now())
        ON CONFLICT (user_id, session_id) DO UPDATE
          SET status = 'active', credit_id = v_credit.id, cancelled_at = NULL, cancel_late = false, promoted_at = now();
        DELETE FROM waitlist WHERE id = v_waitlist.waitlist_id;
        v_promoted := jsonb_build_object(
          'user_id', v_waitlist.user_id, 'email', v_waitlist.email, 'first_name', v_waitlist.first_name,
          'course_name', v_display_name, 'session_type', v_session.session_type,
          'date', v_session.date, 'time_start', v_session.time_start);

        SELECT count(*) INTO v_still_free
        FROM credits
        WHERE user_id = v_waitlist.user_id
          AND total > used AND expires_at > now() AND model <> 'guthaben';
        IF v_still_free = 0 THEN
          FOR v_other IN
            SELECT s2.date, s2.time_start, c2.name AS course_name
            FROM waitlist w
            JOIN sessions s2 ON s2.id = w.session_id
            LEFT JOIN courses c2 ON c2.id = s2.course_id
            WHERE w.user_id = v_waitlist.user_id AND w.type = 'waitlist'
          LOOP
            v_removed_elsewhere := v_removed_elsewhere || jsonb_build_object(
              'email', v_waitlist.email, 'first_name', v_waitlist.first_name,
              'course_name', v_other.course_name, 'date', v_other.date, 'time_start', v_other.time_start);
            BEGIN
              INSERT INTO audit_log (user_id, action, details)
              VALUES (v_waitlist.user_id, 'waitlist_auto_removed', jsonb_build_object(
                'course_name', v_other.course_name,
                'session_date', v_other.date, 'session_time', v_other.time_start,
                'first_name', v_waitlist.first_name, 'reason', 'last_credit_used'));
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
          END LOOP;
          DELETE FROM waitlist WHERE user_id = v_waitlist.user_id AND type = 'waitlist';
        END IF;
        EXIT;
      END IF;
    END LOOP;

    IF v_promoted IS NOT NULL THEN
      BEGIN
        INSERT INTO audit_log (user_id, action, details)
        VALUES ((v_promoted->>'user_id')::uuid, 'waitlist_promoted', jsonb_build_object(
          'session_id', p_session_id,
          'course_name', v_promoted->>'course_name',
          'session_date', v_promoted->>'date', 'session_time', v_promoted->>'time_start',
          'session_type', v_promoted->>'session_type',
          'first_name', v_promoted->>'first_name'));
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

    IF v_promoted IS NULL THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'user_id', w.user_id, 'email', p.email, 'first_name', p.first_name,
        'course_name', v_display_name, 'date', v_session.date,
        'time_start', v_session.time_start, 'session_id', p_session_id)), '[]'::jsonb)
        INTO v_notify
      FROM waitlist w JOIN profiles p ON p.id = w.user_id
      WHERE w.session_id = p_session_id AND w.type = 'notify';
      v_mode := 'notify-only';
    ELSE
      v_mode := 'auto-promoted';
    END IF;

  ELSE
    SELECT EXISTS(SELECT 1 FROM waitlist_offers
      WHERE session_id = p_session_id AND resolved_winner_user_id IS NOT NULL)
      INTO v_winner_exists;
    IF v_winner_exists THEN
      RETURN jsonb_build_object('mode', 'noop');
    END IF;

    IF EXISTS(SELECT 1 FROM waitlist WHERE session_id = p_session_id AND type = 'waitlist') THEN
      FOR v_waitlist IN
        SELECT w.user_id, p.email, p.first_name
        FROM waitlist w JOIN profiles p ON p.id = w.user_id
        WHERE w.session_id = p_session_id AND w.type = 'waitlist'
        ORDER BY w.created_at ASC
      LOOP
        IF v_waitlist.email IS NULL THEN CONTINUE; END IF;
        INSERT INTO waitlist_offers (session_id, user_id, expires_at, claimed_at, resolved_winner_user_id)
        VALUES (p_session_id, v_waitlist.user_id, v_start, NULL, NULL)
        ON CONFLICT (session_id, user_id) DO UPDATE
          SET expires_at = EXCLUDED.expires_at, claimed_at = NULL, resolved_winner_user_id = NULL
        RETURNING token INTO v_token;
        IF v_token IS NULL THEN CONTINUE; END IF;
        v_offers := v_offers || jsonb_build_object(
          'user_id', v_waitlist.user_id, 'email', v_waitlist.email, 'first_name', v_waitlist.first_name,
          'token', v_token, 'course_name', v_display_name,
          'date', v_session.date, 'time_start', v_session.time_start, 'session_type', v_session.session_type);
      END LOOP;
      v_mode := 'late-offer';
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'user_id', w.user_id, 'email', p.email, 'first_name', p.first_name,
        'course_name', v_display_name, 'date', v_session.date,
        'time_start', v_session.time_start, 'session_id', p_session_id)), '[]'::jsonb)
        INTO v_notify
      FROM waitlist w JOIN profiles p ON p.id = w.user_id
      WHERE w.session_id = p_session_id AND w.type = 'notify';
      v_mode := 'notify-only';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'mode', v_mode,
    'promoted', v_promoted,
    'removed_elsewhere', v_removed_elsewhere,
    'offers', v_offers,
    'notify_users', v_notify
  );
END;
$function$
;

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
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token');
  END IF;

  -- Sarah-Fix 2026-05-28: session.name + session_type mitgeben, damit die
  -- Austragen-Bestaetigung den ECHTEN Titel zeigt statt "SYS · Events (...)".
  SELECT w.type, s.date, s.time_start, c.name, s.name, s.session_type
    INTO v_type, v_date, v_time_start, v_course_name, v_session_name, v_session_type
  FROM waitlist w
  JOIN sessions s ON s.id = w.session_id
  JOIN courses c ON c.id = s.course_id
  WHERE w.unsubscribe_token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_removed');
  END IF;

  DELETE FROM waitlist WHERE unsubscribe_token = p_token;

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
$function$
;

CREATE OR REPLACE FUNCTION public.get_cron_health(p_jobname text)
 RETURNS TABLE(jobname text, active boolean, schedule text, last_status text, last_run_at timestamp with time zone, last_message text, minutes_ago integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
BEGIN
  -- Nur Admins dürfen das aufrufen
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Nicht autorisiert';
  END IF;

  RETURN QUERY
  SELECT
    j.jobname::text,
    j.active,
    j.schedule::text,
    d.status::text,
    d.start_time,
    LEFT(COALESCE(d.return_message, '')::text, 200),
    EXTRACT(EPOCH FROM (now() - d.start_time))::integer / 60
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT status, start_time, return_message
    FROM cron.job_run_details
    WHERE jobid = j.jobid
    ORDER BY start_time DESC
    LIMIT 1
  ) d ON true
  WHERE j.jobname = p_jobname;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_system_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
DECLARE
  v_cron_last         timestamptz;
  v_cron_status       text;
  v_cron_active       boolean;
  v_emails_24h        integer;
  v_email_last        timestamptz;
  v_email_failures_7d integer;
  v_audit_last        timestamptz;
  v_bookings_24h      integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Nicht autorisiert';
  END IF;

  SELECT j.active INTO v_cron_active
  FROM cron.job j WHERE j.jobname = 'send-session-reminders';

  SELECT d.start_time, d.status INTO v_cron_last, v_cron_status
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE j.jobname = 'send-session-reminders'
  ORDER BY d.start_time DESC LIMIT 1;

  SELECT MAX(sent_at) INTO v_email_last FROM notification_log;
  SELECT COUNT(*)::int INTO v_emails_24h FROM notification_log
    WHERE sent_at > now() - interval '24 hours';

  -- NEU: nur UNGELESENE Fehler zählen (read=false). Erledigt-markierte
  -- verschwinden aus dem System-Health-Indikator.
  SELECT COUNT(*)::int INTO v_email_failures_7d FROM admin_notifications
    WHERE type = 'email_failed'
      AND read = false
      AND created_at > now() - interval '7 days';

  SELECT MAX(created_at) INTO v_audit_last FROM audit_log;
  SELECT COUNT(*)::int INTO v_bookings_24h FROM bookings
    WHERE created_at > now() - interval '24 hours' AND status = 'active';

  RETURN jsonb_build_object(
    'cron', jsonb_build_object(
      'active', COALESCE(v_cron_active, false),
      'last_status', COALESCE(v_cron_status, 'unbekannt'),
      'last_run_at', v_cron_last,
      'minutes_ago', CASE WHEN v_cron_last IS NOT NULL
        THEN EXTRACT(EPOCH FROM (now() - v_cron_last))::integer / 60 ELSE NULL END
    ),
    'emails', jsonb_build_object(
      'last_sent_at', v_email_last,
      'sent_24h', v_emails_24h
    ),
    'failures_7d', v_email_failures_7d,
    'activity', jsonb_build_object(
      'last_audit_at', v_audit_last,
      'bookings_24h', v_bookings_24h
    )
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.acknowledge_email_failure(failure_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Nicht autorisiert';
  END IF;

  UPDATE public.admin_notifications
  SET read = true
  WHERE id = failure_id AND type = 'email_failed';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_check_yogi_birthdays()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_age int;
BEGIN
  FOR r IN
    SELECT id, first_name, last_name, birthdate
    FROM profiles
    WHERE birthdate IS NOT NULL
      AND is_admin = false
      AND is_dummy = false
      AND first_name <> 'Gelöschter'
      AND EXTRACT(MONTH FROM birthdate) = EXTRACT(MONTH FROM CURRENT_DATE)
      AND EXTRACT(DAY FROM birthdate)   = EXTRACT(DAY FROM CURRENT_DATE)
  LOOP
    -- Dedup: nicht doppelt am gleichen Tag
    IF EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE type = 'yogi_birthday'
        AND (details->>'user_id') = r.id::text
        AND created_at::date = CURRENT_DATE
    ) THEN CONTINUE; END IF;

    v_age := EXTRACT(YEAR FROM age(r.birthdate))::int;
    INSERT INTO admin_notifications (type, message, details, read)
    VALUES (
      'yogi_birthday',
      r.first_name || ' ' || r.last_name || ' hat heute Geburtstag 🎂 (wird ' || v_age || ')',
      jsonb_build_object('user_id', r.id, 'name', r.first_name || ' ' || r.last_name, 'age', v_age),
      false
    );
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_check_courses_ending_soon()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
BEGIN
  -- Kurse die GENAU in 14 Tagen enden (date_end = today + 14)
  FOR r IN
    SELECT id, name, date_end
    FROM courses
    WHERE is_active = true
      AND date_end = (CURRENT_DATE + INTERVAL '14 days')::date
  LOOP
    -- Dedup: pro Kurs nur 1 Notification
    IF EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE type = 'course_ending_soon'
        AND (details->>'course_id') = r.id::text
        AND read = false
    ) THEN CONTINUE; END IF;

    INSERT INTO admin_notifications (type, message, details, read)
    VALUES (
      'course_ending_soon',
      'Kurs "' || r.name || '" endet in 14 Tagen ('
        || to_char(r.date_end, 'DD.MM.') || ') — Folgekurs anlegen?',
      jsonb_build_object('course_id', r.id, 'course_name', r.name, 'end_date', r.date_end),
      false
    );
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_check_reminder_cron_silent()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'cron'
AS $function$
DECLARE
  v_last_run timestamptz;
  v_hours_ago int;
BEGIN
  SELECT MAX(d.start_time) INTO v_last_run
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE j.jobname = 'send-session-reminders';

  IF v_last_run IS NULL THEN RETURN; END IF;
  v_hours_ago := EXTRACT(EPOCH FROM (now() - v_last_run)) / 3600;

  IF v_hours_ago >= 24 THEN
    -- Dedup: nicht stündlich wiederholen — pro Tag max 1
    IF EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE type = 'cron_silent_24h'
        AND created_at > now() - interval '20 hours'
    ) THEN RETURN; END IF;

    INSERT INTO admin_notifications (type, message, details, read)
    VALUES (
      'cron_silent_24h',
      'Reminder-Cron läuft seit ' || v_hours_ago || 'h nicht mehr (letzter Lauf: '
        || to_char(v_last_run, 'DD.MM. HH24:MI') || ')',
      jsonb_build_object('last_run', v_last_run, 'hours_silent', v_hours_ago),
      false
    );
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_check_brevo_quota()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'net'
AS $function$
DECLARE
  v_request_id bigint;
  v_response  jsonb;
  v_credits   int;
  v_brevo_key text;
BEGIN
  -- Brevo-API-Key aus Supabase Vault holen (falls dort gespeichert)
  -- Fallback: per RPC oder env. Hier via vault.decrypted_secrets:
  SELECT decrypted_secret INTO v_brevo_key
    FROM vault.decrypted_secrets WHERE name = 'BREVO_API_KEY' LIMIT 1;

  IF v_brevo_key IS NULL THEN
    -- Key nicht im Vault — überspringen (Admin muss Key dort speichern)
    RETURN;
  END IF;

  -- Async-Request anstoßen
  SELECT net.http_get(
    url := 'https://api.brevo.com/v3/account',
    headers := jsonb_build_object('api-key', v_brevo_key, 'accept', 'application/json')
  ) INTO v_request_id;

  -- Warten + Result holen (pg_net ist async, daher mini-poll)
  PERFORM pg_sleep(2);
  SELECT (response->>'body')::jsonb INTO v_response
    FROM net._http_response WHERE id = v_request_id;

  IF v_response IS NULL THEN RETURN; END IF;

  -- Brevo returnt plan: [{credits: int, ...}]
  v_credits := (v_response->'plan'->0->>'credits')::int;
  IF v_credits IS NULL THEN RETURN; END IF;

  -- Schwelle: <300 Credits = Warnung
  IF v_credits < 300 THEN
    -- Dedup: max 1x pro Tag
    IF EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE type = 'brevo_quota_warning'
        AND created_at > now() - interval '20 hours'
    ) THEN RETURN; END IF;

    INSERT INTO admin_notifications (type, message, details, read)
    VALUES (
      'brevo_quota_warning',
      'Brevo-Kontingent nur noch bei ' || v_credits || ' Mails — Plan upgraden!',
      jsonb_build_object('credits_remaining', v_credits, 'checked_at', now()),
      false
    );
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_notify_cancellation_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_open_count integer;
  v_total_count integer;
  v_refund_count integer;
  v_guthaben_count integer;
  v_course_name text;
  v_existing_count integer;
BEGIN
  -- Nur reagieren wenn dieser Eintrag GERADE eine Antwort bekommen hat
  IF NEW.choice IS NULL OR (OLD.choice IS NOT NULL AND OLD.choice = NEW.choice) THEN
    RETURN NEW;
  END IF;

  -- Sind noch andere Yogis offen für DIESEN Kurs?
  SELECT count(*) INTO v_open_count
  FROM course_cancellation_responses
  WHERE course_id = NEW.course_id
    AND choice IS NULL
    AND expires_at >= NOW();

  -- Wenn ja → nichts tun, warten bis der letzte antwortet
  IF v_open_count > 0 THEN
    RETURN NEW;
  END IF;

  -- Schon eine "complete"-Notification für diesen Kurs erstellt? Doppel-Insert vermeiden.
  SELECT count(*) INTO v_existing_count
  FROM admin_notifications
  WHERE type = 'course_cancellation_complete'
    AND details->>'course_id' = NEW.course_id::text;
  IF v_existing_count > 0 THEN
    RETURN NEW;
  END IF;

  -- Statistik fuer die Notification sammeln
  SELECT count(*),
         count(*) FILTER (WHERE choice = 'erstattung'),
         count(*) FILTER (WHERE choice = 'guthaben')
    INTO v_total_count, v_refund_count, v_guthaben_count
  FROM course_cancellation_responses
  WHERE course_id = NEW.course_id;

  SELECT name INTO v_course_name FROM courses WHERE id = NEW.course_id;

  -- Notification einfuegen
  INSERT INTO admin_notifications (type, message, details, read, created_at)
  VALUES (
    'course_cancellation_complete',
    format('%s Yogi%s ha%s zum Kursabbruch "%s" geantwortet: %s × Erstattung, %s × Guthaben.',
      v_total_count,
      CASE WHEN v_total_count = 1 THEN '' ELSE 's' END,
      CASE WHEN v_total_count = 1 THEN 't' ELSE 'ben' END,
      COALESCE(v_course_name, '(unbekannt)'),
      v_refund_count,
      v_guthaben_count),
    jsonb_build_object(
      'course_id', NEW.course_id,
      'course_name', v_course_name,
      'total', v_total_count,
      'refunds', v_refund_count,
      'guthaben', v_guthaben_count
    ),
    false,
    NOW()
  );

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_expire_cancellation_tokens()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
BEGIN
  -- Alle abgelaufenen Tokens ohne Wahl: Default = Erstattung
  FOR v_row IN
    SELECT id, user_id, course_id, remaining_sessions, provisional_credit_id
    FROM course_cancellation_responses
    WHERE choice IS NULL
      AND expires_at <= NOW()
  LOOP
    -- Provisorisches Guthaben loeschen (Yogi bekommt stattdessen Geld)
    IF v_row.provisional_credit_id IS NOT NULL THEN
      DELETE FROM credits WHERE id = v_row.provisional_credit_id;
    END IF;

    -- Verrechnetes Altguthaben dauerhaft reduzieren (wie bei manueller Erstattung)
    PERFORM apply_cancellation_refund(v_row.id);

    -- Choice setzen -> Trigger trg_notify_refund_pending feuert
    -- und erzeugt admin_notification 'refund_pending'
    UPDATE course_cancellation_responses
       SET choice = 'erstattung',
           responded_at = NOW()
     WHERE id = v_row.id;

    -- Audit
    INSERT INTO audit_log (user_id, action, details)
    VALUES (
      v_row.user_id,
      'token_expired_auto_refund',
      jsonb_build_object(
        'response_id', v_row.id,
        'course_id', v_row.course_id,
        'remaining_sessions', v_row.remaining_sessions,
        'reason', 'no_choice_within_7d_default_refund'
      )
    );
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_check_guthaben_2y_expiry()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_yogi_name text;
  v_unused integer;
  v_course_name text;
  v_payload jsonb;
  v_secret text;
BEGIN
  -- Secret aus Vault (gleicher Wert wie EDGE_FUNCTION_SECRET).
  -- Vault-Name ist 'edge_function_secret' (falls anders: anpassen).
  -- Falls Vault leer ist, faellt der Wert auf NULL -> Email wird uebersprungen,
  -- Dashboard-Notification bleibt aber bestehen (Belt-and-Suspenders).
  BEGIN
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets
     WHERE name = 'edge_function_secret'
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  FOR v_row IN
    SELECT c.id, c.user_id, c.total, c.used, (c.total - c.used) AS unused, c.expires_at, c.created_at, c.course_id,
           p.first_name, p.last_name, p.email
      FROM credits c
      LEFT JOIN profiles p ON p.id = c.user_id
     WHERE c.source = 'cancellation_choice'
       AND c.expires_at <= NOW()
       AND (c.total - c.used) > 0
  LOOP
    v_yogi_name := COALESCE(NULLIF(TRIM(COALESCE(v_row.first_name,'') || ' ' || COALESCE(v_row.last_name,'')), ''), 'Yogi');
    v_unused := v_row.unused;

    v_course_name := NULL;
    IF v_row.course_id IS NOT NULL THEN
      SELECT name INTO v_course_name FROM courses WHERE id = v_row.course_id;
    END IF;

    -- Dedup: pro credit-id nur 1 Notification
    IF NOT EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE type = 'refund_pending_auto_2y'
        AND (details->>'credit_id') = v_row.id::text
    ) THEN
      INSERT INTO admin_notifications (type, message, details, read)
      VALUES (
        'refund_pending_auto_2y',
        'Guthaben von Yogi ' || v_yogi_name || ' ist nach 2 Jahren abgelaufen ('
          || v_unused || ' ungenutzte Credits) -> bitte Geldbetrag automatisch erstatten',
        jsonb_build_object(
          'credit_id', v_row.id,
          'user_id', v_row.user_id,
          'yogi_name', v_yogi_name,
          'unused_credits', v_unused,
          'expired_at', v_row.expires_at
        ),
        false
      );

      -- Email an Sarah via trigger-admin-email (Add-on, Fehler ignorieren).
      -- Secret-Header verlangt von trigger-admin-email v2.
      IF v_secret IS NOT NULL THEN
        BEGIN
          v_payload := jsonb_build_object(
            'type', 'admin_guthaben_2y_expiry',
            'data', jsonb_build_object(
              'yogiName', v_yogi_name,
              'yogiEmail', COALESCE(v_row.email, ''),
              'unusedCredits', v_unused,
              'originalCourseName', v_course_name,
              'creditCreatedAt', v_row.created_at
            )
          );
          PERFORM net.http_post(
            url := 'https://jcczvyablgdijeiyymhc.supabase.co/functions/v1/trigger-admin-email',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-trigger-secret', v_secret
            ),
            body := v_payload,
            timeout_milliseconds := 15000
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'guthaben_2y_expiry email skipped: %', SQLERRM;
        END;
      END IF;
    END IF;

    UPDATE credits SET used = total WHERE id = v_row.id;

    INSERT INTO audit_log (user_id, action, details)
    VALUES (
      v_row.user_id,
      'guthaben_2y_auto_refund',
      jsonb_build_object(
        'credit_id', v_row.id,
        'unused_credits', v_unused
      )
    );
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_event_paid_7d_cancel_block()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session_type text;
  v_session_start timestamptz;
  v_caller_is_admin boolean;
BEGIN
  -- Nur wenn status sich von active -> cancelled aendert
  IF NOT (OLD.status = 'active' AND NEW.status = 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Admin (im Profil) darf jederzeit austragen -- keine Frist
  SELECT COALESCE(is_admin, false) INTO v_caller_is_admin
  FROM profiles WHERE id = auth.uid();
  IF v_caller_is_admin THEN
    RETURN NEW;
  END IF;

  -- session_type + Startzeit der Session laden
  SELECT s.session_type,
         (s.date::timestamp + s.time_start) AT TIME ZONE 'Europe/Berlin'
    INTO v_session_type, v_session_start
  FROM sessions s
  WHERE s.id = NEW.session_id;

  -- Nur event_paid betroffen
  IF v_session_type IS DISTINCT FROM 'event_paid' THEN
    RETURN NEW;
  END IF;

  -- 60-Min-Gnadenfrist nach Auto-Promote (Nachruecken von der Warteliste):
  -- Wer gerade erst nachgerueckt ist, darf sich innerhalb von 60 Minuten noch
  -- kostenlos wieder abmelden -- auch innerhalb der 7-Tage-Frist.
  IF NEW.promoted_at IS NOT NULL AND (now() - NEW.promoted_at) < interval '60 minutes' THEN
    RETURN NEW;
  END IF;

  -- 7-Tage-Frist
  IF v_session_start - now() < interval '7 days' THEN
    RAISE EXCEPTION 'Selbst-Abmeldung von bezahlten Events ist innerhalb der 7-Tage-Stornofrist nicht moeglich. Wende dich bitte an Sarah (Ersatzkandidat).'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_old_courses_with_credits()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c RECORD;
  v_total_credits int;
BEGIN
  FOR c IN
    SELECT id, name, date_end, is_active
    FROM courses
    WHERE is_system_container IS NOT TRUE
      AND (
        (date_end IS NOT NULL AND date_end < (CURRENT_DATE - INTERVAL '8 days'))
        OR (is_active = false)
      )
  LOOP
    SELECT COUNT(*) INTO v_total_credits FROM credits WHERE course_id = c.id;
    IF v_total_credits = 0 THEN CONTINUE; END IF;
    DELETE FROM bookings WHERE credit_id IN (SELECT id FROM credits WHERE course_id = c.id);
    DELETE FROM credits WHERE course_id = c.id;
    DELETE FROM enrollments WHERE course_id = c.id;
    INSERT INTO audit_log(action, details)
    VALUES (
      'course_credits_auto_expired',
      jsonb_build_object('course_id', c.id, 'course_name', c.name, 'date_end', c.date_end, 'credits_removed', v_total_credits)
    );
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.anonymize_user_audit_logs(target_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_is_admin boolean;
  v_count integer := 0;
BEGIN
  -- Nur Admin oder der User selbst (für /profil-Self-Delete) darf aufrufen
  SELECT COALESCE(is_admin, false) INTO v_caller_is_admin
  FROM profiles WHERE id = auth.uid();

  IF NOT v_caller_is_admin AND auth.uid() <> target_user_id THEN
    RAISE EXCEPTION 'Nicht berechtigt';
  END IF;

  -- Sensible Felder aus details JSONB entfernen
  UPDATE audit_log
  SET details = details
    - 'email'
    - 'user_email'
    - 'yogi_email'
    - 'yogi_name'
    - 'full_name'
    - 'first_name'
    - 'last_name'
    - 'ip_address'
    - 'user_agent'
  WHERE user_id = target_user_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_pending_session_reminders()
 RETURNS TABLE(user_id uuid, session_id uuid, hours_before integer, email text, first_name text, course_name text, session_type text, session_date date, session_time time without time zone, duration_min integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.id AS user_id,
    s.id AS session_id,
    p.notify_session_reminder_hours AS hours_before,
    p.email,
    p.first_name,
    -- Welle 6.1: bei Container-Sessions echter session.name statt SYS-Container.
    COALESCE(NULLIF(s.name, ''), c.name) AS course_name,
    s.session_type,
    s.date AS session_date,
    s.time_start AS session_time,
    s.duration_min
  FROM profiles p
  JOIN bookings b ON b.user_id = p.id AND b.status = 'active'
  JOIN sessions s ON s.id = b.session_id AND s.is_cancelled = false
  JOIN courses c ON c.id = s.course_id
  WHERE p.notify_session_reminder_hours IS NOT NULL
    AND p.email IS NOT NULL
    AND COALESCE(p.is_dummy, false) = false
    AND ((s.date::timestamp + s.time_start) AT TIME ZONE 'Europe/Berlin') BETWEEN
        (now() + (p.notify_session_reminder_hours::text || ' hours')::interval - interval '30 minutes')
        AND
        (now() + (p.notify_session_reminder_hours::text || ' hours')::interval + interval '30 minutes')
    AND NOT EXISTS (
      SELECT 1 FROM notification_log nl
      WHERE nl.user_id = p.id AND nl.session_id = s.id AND nl.type = 'session_reminder'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.list_email_failures()
 RETURNS TABLE(id uuid, created_at timestamp with time zone, recipient text, subject text, error text, status integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Nicht autorisiert';
  END IF;

  RETURN QUERY
  SELECT
    n.id,
    n.created_at,
    COALESCE(n.details->>'to', '—') AS recipient,
    COALESCE(n.details->>'subject', '—') AS subject,
    COALESCE(n.details->>'error', n.message) AS error,
    COALESCE((n.details->>'status')::int, 0) AS status
  FROM public.admin_notifications n
  WHERE n.type = 'email_failed'
    AND n.read = false
    AND n.created_at > now() - interval '7 days'
  ORDER BY n.created_at DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_session_max_spots_on_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_max_spots integer;
  v_current_active integer;
  v_caller_is_admin boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_caller_is_admin
  FROM profiles WHERE id = auth.uid();
  IF v_caller_is_admin THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(s.max_spots, c.max_spots) INTO v_max_spots
  FROM sessions s
  LEFT JOIN courses c ON c.id = s.course_id
  WHERE s.id = NEW.session_id;

  IF v_max_spots IS NULL OR v_max_spots = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_current_active
  FROM bookings
  WHERE session_id = NEW.session_id
    AND status = 'active'
    AND id <> NEW.id;

  IF v_current_active >= v_max_spots THEN
    RAISE EXCEPTION 'Session ist ausgebucht (max_spots=%, aktiv=%)', v_max_spots, v_current_active
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_notify_refund_pending()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_yogi_name text;
  v_course_name text;
BEGIN
  IF NEW.choice = 'erstattung' AND COALESCE(NEW.refund_paid, false) = false THEN
    -- Dedup: existiert IRGENDEINE Notification fuer diesen response_id?
    -- (read ODER unread - Sarah hat sie schon gesehen).
    IF EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE type = 'refund_pending'
        AND (details->>'response_id') = NEW.id::text
    ) THEN
      RETURN NEW;
    END IF;

    SELECT first_name || ' ' || last_name INTO v_yogi_name
      FROM profiles WHERE id = NEW.user_id;
    SELECT name INTO v_course_name FROM courses WHERE id = NEW.course_id;

    INSERT INTO admin_notifications (type, message, details, read)
    VALUES (
      'refund_pending',
      COALESCE(v_yogi_name, 'Yogi') || ' wählte Erstattung — '
        || NEW.remaining_sessions || ' Stunden offen',
      jsonb_build_object(
        'response_id', NEW.id,
        'user_id', NEW.user_id,
        'course_id', NEW.course_id,
        'course_name', v_course_name,
        'remaining_sessions', NEW.remaining_sessions
      ),
      false
    );
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_notify_subscribers(p_session_id uuid, p_user_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_has_booking boolean;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT COALESCE(is_admin, false) INTO v_is_admin FROM profiles WHERE id = v_caller;
    SELECT EXISTS(SELECT 1 FROM bookings WHERE user_id = v_caller AND session_id = p_session_id)
      INTO v_has_booking;
    IF NOT v_is_admin AND NOT v_has_booking THEN
      RAISE EXCEPTION 'Nicht berechtigt für diese Session';
    END IF;
  END IF;
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM waitlist
  WHERE session_id = p_session_id AND type = 'notify' AND user_id = ANY(p_user_ids);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_check_illness_credit_expiry(p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row        record;
  v_deleted    integer := 0;
  v_candidates integer := 0;
BEGIN
  IF p_dry_run THEN
    SELECT count(*) INTO v_candidates
      FROM credits
     WHERE source = 'illness' AND expires_at <= now();
    IF v_candidates > 0 THEN
      INSERT INTO admin_notifications (type, message, details, read)
      VALUES (
        'illness_cleanup_dryrun',
        format('Trockenlauf Krankheits-Guthaben: %s abgelaufene Guthaben (10 Monate) wuerden geloescht.', v_candidates),
        jsonb_build_object('candidate_count', v_candidates, 'dry_run', true),
        false
      );
    END IF;
    RETURN jsonb_build_object('dry_run', true, 'candidates', v_candidates);
  END IF;

  FOR v_row IN
    SELECT id, user_id, (total - used) AS unused
      FROM credits
     WHERE source = 'illness' AND expires_at <= now()
  LOOP
    INSERT INTO audit_log (user_id, action, details)
    VALUES (
      v_row.user_id,
      'illness_credit_expired',
      jsonb_build_object('credit_id', v_row.id, 'unused_credits', v_row.unused)
    );
    DELETE FROM credits WHERE id = v_row.id;
    v_deleted := v_deleted + 1;
  END LOOP;

  RETURN jsonb_build_object('dry_run', false, 'deleted', v_deleted);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.read_invitation_by_token(p_token text)
 RETURNS TABLE(id uuid, token text, email text, first_name text, last_name text, course_id uuid, course_name text, course_total_units integer, credits_to_assign integer, used boolean, expires_at timestamp with time zone, created_at timestamp with time zone)
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
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_self_admin_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    IF auth.uid() IS NULL THEN
      RETURN NEW;
    END IF;
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Nicht erlaubt: is_admin kann nicht selbst gesetzt werden.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.consume_invitation_enrollment(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_inv          public.invitations%ROWTYPE;
  v_user_email   text;
  v_credit_id    uuid;
  v_expires      timestamptz;
  v_last_date    date;
  v_booking_cnt  int := 0;
  v_sid          uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_inv FROM public.invitations WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN
    RAISE EXCEPTION 'invitation expired' USING ERRCODE = 'check_violation';
  END IF;

  IF v_inv.course_id IS NULL OR v_inv.credits_to_assign IS NULL THEN
    RETURN jsonb_build_object('enrolled', false, 'reason', 'no_course');
  END IF;

  SELECT email INTO v_user_email FROM public.profiles WHERE id = v_uid;
  IF lower(coalesce(v_user_email, '')) <> lower(coalesce(v_inv.email, '')) THEN
    RAISE EXCEPTION 'email mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM public.enrollments WHERE user_id = v_uid AND course_id = v_inv.course_id) THEN
    RETURN jsonb_build_object('enrolled', true, 'already', true);
  END IF;

  INSERT INTO public.enrollments (user_id, course_id) VALUES (v_uid, v_inv.course_id);

  SELECT max(date) INTO v_last_date
  FROM public.sessions
  WHERE course_id = v_inv.course_id AND is_cancelled = false AND date >= current_date;

  IF v_last_date IS NOT NULL THEN
    v_expires := (v_last_date + interval '8 days');
  ELSE
    v_expires := date_trunc('quarter', now()) + interval '3 months' - interval '1 second';
  END IF;

  INSERT INTO public.credits (user_id, total, used, expires_at, course_id, model)
  VALUES (v_uid, v_inv.credits_to_assign, 0, v_expires, v_inv.course_id, 'course')
  RETURNING id INTO v_credit_id;

  FOR v_sid IN
    SELECT id FROM public.sessions
    WHERE course_id = v_inv.course_id AND is_cancelled = false AND date >= current_date
  LOOP
    INSERT INTO public.bookings (user_id, session_id, credit_id, type, status)
    VALUES (v_uid, v_sid, v_credit_id, 'course', 'active');
    v_booking_cnt := v_booking_cnt + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'enrolled', true,
    'credit_id', v_credit_id,
    'credits_total', v_inv.credits_to_assign,
    'bookings', v_booking_cnt
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_self_cancel_late_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_type  text;
  v_start timestamptz;
BEGIN
  IF NOT (OLD.status = 'active' AND NEW.status = 'cancelled') THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  SELECT s.session_type,
         (s.date::timestamp + s.time_start) AT TIME ZONE 'Europe/Berlin'
    INTO v_type, v_start
  FROM public.sessions s
  WHERE s.id = NEW.session_id;
  IF v_type IS DISTINCT FROM 'course_session' AND v_type IS DISTINCT FROM 'single' THEN
    RETURN NEW;
  END IF;
  IF NEW.promoted_at IS NOT NULL AND (now() - NEW.promoted_at) < interval '60 minutes' THEN
    NEW.cancel_late := false;
  ELSIF now() > (v_start - interval '3 hours') THEN
    NEW.cancel_late := true;
  ELSE
    NEW.cancel_late := false;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_inactive_accounts(p_months integer DEFAULT 24)
 RETURNS TABLE(user_id uuid, last_sign_in_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT u.id, u.last_sign_in_at
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE COALESCE(p.is_admin, false) = false
    AND p.first_name IS DISTINCT FROM 'Gelöschter'
    AND u.last_sign_in_at IS NOT NULL
    AND GREATEST(
          u.last_sign_in_at,
          COALESCE((
            SELECT max(a.created_at)
            FROM public.audit_log a
            WHERE a.user_id = u.id
               OR a.details->>'user_id' = u.id::text
          ), u.last_sign_in_at)
        ) < now() - make_interval(months => GREATEST(p_months, 1))
    AND NOT EXISTS (
      SELECT 1 FROM public.credits c
      WHERE c.user_id = u.id AND c.total > c.used AND c.expires_at > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.sessions s ON s.id = b.session_id
      WHERE b.user_id = u.id AND b.status = 'active' AND s.date >= current_date
    );
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_inactive_accounts(p_dry_run boolean DEFAULT true, p_limit integer DEFAULT 50, p_months integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids      uuid[];
  v_id       uuid;
  v_deleted  integer := 0;
  v_failed   integer := 0;
  v_is_admin boolean;
  v_count    integer := 0;
BEGIN
  SELECT array_agg(t.user_id) INTO v_ids
  FROM (
    SELECT user_id FROM public.find_inactive_accounts(p_months)
    LIMIT GREATEST(p_limit, 0)
  ) t;
  v_ids := COALESCE(v_ids, ARRAY[]::uuid[]);
  v_count := COALESCE(array_length(v_ids, 1), 0);

  IF p_dry_run THEN
    IF v_count > 0 THEN
      INSERT INTO public.admin_notifications(type, message, details)
      VALUES (
        'inactivity_cleanup_dryrun',
        format('Trockenlauf Inaktivitäts-Löschung: %s Konto(en) wären löschbar (>= %s Monate inaktiv).',
               v_count, p_months),
        jsonb_build_object('candidate_count', v_count, 'months', p_months, 'dry_run', true)
      );
    END IF;
    INSERT INTO public.audit_log(action, details)
    VALUES ('inactivity_cleanup_dryrun',
            jsonb_build_object('candidate_count', v_count, 'months', p_months));
    RETURN jsonb_build_object('dry_run', true, 'candidates', v_count);
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    BEGIN
      SELECT COALESCE(is_admin, false) INTO v_is_admin FROM public.profiles WHERE id = v_id;
      IF COALESCE(v_is_admin, true) THEN
        CONTINUE;
      END IF;

      UPDATE public.audit_log SET details = details
        - 'email' - 'user_email' - 'yogi_email' - 'yogi_name'
        - 'full_name' - 'first_name' - 'last_name' - 'ip_address' - 'user_agent'
      WHERE user_id = v_id;
      UPDATE public.audit_log SET user_id = NULL WHERE user_id = v_id;

      DELETE FROM public.waitlist                      WHERE user_id = v_id;
      DELETE FROM public.waitlist_offers               WHERE user_id = v_id OR resolved_winner_user_id = v_id;
      DELETE FROM public.bookings                       WHERE user_id = v_id;
      DELETE FROM public.credits                        WHERE user_id = v_id;
      DELETE FROM public.enrollments                    WHERE user_id = v_id;
      DELETE FROM public.notification_log               WHERE user_id = v_id;
      DELETE FROM public.course_cancellation_responses  WHERE user_id = v_id;
      DELETE FROM public.legal_acceptances              WHERE user_id = v_id;
      DELETE FROM public.yogi_notifications             WHERE user_id = v_id;

      INSERT INTO public.audit_log(action, details)
      VALUES ('yogi_auto_deleted_inactive', jsonb_build_object('months_inactive', p_months));

      DELETE FROM public.profiles WHERE id = v_id;
      DELETE FROM auth.users      WHERE id = v_id;

      v_deleted := v_deleted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      INSERT INTO public.audit_log(action, details)
      VALUES ('inactivity_cleanup_error', jsonb_build_object('error', SQLERRM));
    END;
  END LOOP;

  INSERT INTO public.admin_notifications(type, message, details)
  VALUES (
    'inactivity_cleanup',
    format('Inaktivitäts-Löschung ausgeführt: %s Konto(en) gelöscht, %s Fehler.', v_deleted, v_failed),
    jsonb_build_object('deleted', v_deleted, 'failed', v_failed, 'months', p_months, 'dry_run', false)
  );

  RETURN jsonb_build_object('dry_run', false, 'deleted', v_deleted, 'failed', v_failed);
END;
$function$
;

CREATE TRIGGER trg_prevent_booking_cancelled BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION prevent_booking_cancelled_session();

CREATE TRIGGER trg_sync_credits_session AFTER UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION sync_credits_on_session_cancel();

CREATE TRIGGER trg_sync_credit_used AFTER INSERT OR DELETE OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION sync_credit_used_on_booking_change();

CREATE TRIGGER on_profile_created_enroll AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION handle_invitation_enrollment();

CREATE TRIGGER on_profile_deleted AFTER DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION delete_auth_user_on_profile_delete();

CREATE TRIGGER on_session_change AFTER INSERT OR DELETE OR UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION update_course_total_units();

CREATE TRIGGER trg_enforce_max_spots BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION enforce_session_max_spots();

CREATE TRIGGER trg_enforce_max_spots_update BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION enforce_session_max_spots_on_update();

CREATE TRIGGER trg_notify_cancellation_complete AFTER UPDATE ON public.course_cancellation_responses FOR EACH ROW EXECUTE FUNCTION fn_notify_cancellation_complete();

CREATE TRIGGER trg_notify_admin_new_yogi AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION fn_notify_admin_new_yogi();

CREATE TRIGGER trg_enforce_event_paid_7d_cancel_block BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION enforce_event_paid_7d_cancel_block();

CREATE TRIGGER trg_prevent_self_admin_escalation BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION prevent_self_admin_escalation();

CREATE TRIGGER trg_enforce_self_cancel_late_flag BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION enforce_self_cancel_late_flag();

CREATE TRIGGER trg_notify_refund_pending AFTER INSERT OR UPDATE OF choice ON public.course_cancellation_responses FOR EACH ROW EXECUTE FUNCTION fn_notify_refund_pending();

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.course_cancellation_responses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_announcement ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.yogi_notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agb_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.waitlist_offers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Eigene Warteliste anlegen" ON public.waitlist AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "Eigene Warteliste löschen" ON public.waitlist AS PERMISSIVE FOR DELETE TO public USING ((user_id = auth.uid()));

CREATE POLICY "Eigene Einbuchungen lesen" ON public.enrollments AS PERMISSIVE FOR SELECT TO public USING ((user_id = auth.uid()));

CREATE POLICY "Eigene Buchung anlegen" ON public.bookings AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "Eigene Buchung stornieren" ON public.bookings AS PERMISSIVE FOR UPDATE TO public USING ((user_id = auth.uid()));

CREATE POLICY "Eigene Warteliste lesen" ON public.waitlist AS PERMISSIVE FOR SELECT TO public USING ((user_id = auth.uid()));

CREATE POLICY "Yogi loescht eigene Einbuchung" ON public.enrollments AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY "Yogi loescht eigene Credits" ON public.credits AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY "Teilnehmer legt Offers an" ON public.waitlist_offers AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_admin() OR (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.session_id = waitlist_offers.session_id) AND (b.user_id = auth.uid()))))));

CREATE POLICY "Eigene Offers aktualisieren" ON public.waitlist_offers AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY "Eigene Offers lesen" ON public.waitlist_offers AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY "Admin verwaltet Offers" ON public.waitlist_offers AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Yogi schreibt eigene Audit-Eintraege" ON public.audit_log AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR (((details ->> 'user_id'::text))::uuid = auth.uid()) OR is_admin() OR (auth.uid() IS NULL)));

CREATE POLICY only_admin_can_update_announcement ON public.admin_announcement AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY yogi_notifications_select_own ON public.yogi_notifications AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

CREATE POLICY all_authenticated_can_read_announcement ON public.admin_announcement AS PERMISSIVE FOR SELECT TO authenticated USING (true);

CREATE POLICY only_admin_can_insert_agb_versions ON public.agb_versions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY anyone_can_read_agb_versions ON public.agb_versions AS PERMISSIVE FOR SELECT TO authenticated USING (true);

CREATE POLICY "System schreibt Notification-Log" ON public.notification_log AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Admin liest Notification-Log" ON public.notification_log AS PERMISSIVE FOR SELECT TO public USING (is_admin());

CREATE POLICY "Admin verwaltet Sessions" ON public.sessions AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Admin verwaltet Einbuchungen" ON public.enrollments AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Admin verwaltet Credits" ON public.credits AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Admin verwaltet Kurse" ON public.courses AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Admin verwaltet Buchungen" ON public.bookings AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Profil anlegen" ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((auth.uid() = id) OR is_admin()));

CREATE POLICY "Eigene Buchungen lesen" ON public.bookings AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY "Kurse lesen" ON public.courses AS PERMISSIVE FOR SELECT TO authenticated USING (true);

CREATE POLICY "Sessions lesen" ON public.sessions AS PERMISSIVE FOR SELECT TO authenticated USING (true);

CREATE POLICY yogi_notifications_insert_admin ON public.yogi_notifications AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY yogi_notifications_update_own ON public.yogi_notifications AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

CREATE POLICY "Profil löschen" ON public.profiles AS PERMISSIVE FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY "Profil bearbeiten" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING (((auth.uid() = id) OR is_admin())) WITH CHECK (((auth.uid() = id) OR is_admin()));

CREATE POLICY "Profil lesen" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING (((auth.uid() = id) OR is_admin()));

CREATE POLICY "Admin verwaltet Kursabbruch-Antworten" ON public.course_cancellation_responses AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Admin only" ON public.admin_notifications AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Admin liest Protokoll" ON public.audit_log AS PERMISSIVE FOR SELECT TO authenticated USING (is_admin());

CREATE POLICY "Admin liest alle Zustimmungen" ON public.legal_acceptances AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Admin verwaltet Einladungen" ON public.invitations AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Credits lesen" ON public.credits AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY "Admin verwaltet Warteliste" ON public.waitlist AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Eigene Zustimmung anlegen" ON public.legal_acceptances AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "Eigene Zustimmung lesen" ON public.legal_acceptances AS PERMISSIVE FOR SELECT TO public USING ((user_id = auth.uid()));

GRANT REFERENCES ON public.admin_notifications TO authenticated;

GRANT TRIGGER ON public.admin_notifications TO authenticated;

GRANT INSERT ON public.admin_notifications TO service_role;

GRANT SELECT ON public.admin_notifications TO service_role;

GRANT UPDATE ON public.admin_notifications TO service_role;

GRANT DELETE ON public.admin_notifications TO service_role;

GRANT TRUNCATE ON public.admin_notifications TO service_role;

GRANT REFERENCES ON public.admin_notifications TO service_role;

GRANT TRIGGER ON public.admin_notifications TO service_role;

GRANT TRUNCATE ON public.agb_versions TO anon;

GRANT REFERENCES ON public.agb_versions TO anon;

GRANT TRIGGER ON public.agb_versions TO anon;

GRANT SELECT ON public.agb_versions TO authenticated;

GRANT TRUNCATE ON public.agb_versions TO authenticated;

GRANT REFERENCES ON public.agb_versions TO authenticated;

GRANT TRIGGER ON public.agb_versions TO authenticated;

GRANT INSERT ON public.agb_versions TO service_role;

GRANT SELECT ON public.agb_versions TO service_role;

GRANT UPDATE ON public.agb_versions TO service_role;

GRANT DELETE ON public.agb_versions TO service_role;

GRANT TRUNCATE ON public.agb_versions TO service_role;

GRANT REFERENCES ON public.agb_versions TO service_role;

GRANT TRIGGER ON public.agb_versions TO service_role;

GRANT TRUNCATE ON public.yogi_notifications TO anon;

GRANT REFERENCES ON public.yogi_notifications TO anon;

GRANT TRIGGER ON public.yogi_notifications TO anon;

GRANT INSERT ON public.yogi_notifications TO authenticated;

GRANT SELECT ON public.yogi_notifications TO authenticated;

GRANT UPDATE ON public.yogi_notifications TO authenticated;

GRANT TRUNCATE ON public.yogi_notifications TO authenticated;

GRANT REFERENCES ON public.yogi_notifications TO authenticated;

GRANT TRIGGER ON public.yogi_notifications TO authenticated;

GRANT INSERT ON public.yogi_notifications TO service_role;

GRANT SELECT ON public.yogi_notifications TO service_role;

GRANT UPDATE ON public.yogi_notifications TO service_role;

GRANT DELETE ON public.yogi_notifications TO service_role;

GRANT TRUNCATE ON public.yogi_notifications TO service_role;

GRANT REFERENCES ON public.yogi_notifications TO service_role;

GRANT TRIGGER ON public.yogi_notifications TO service_role;

GRANT TRUNCATE ON public.admin_announcement TO anon;

GRANT REFERENCES ON public.admin_announcement TO anon;

GRANT TRIGGER ON public.admin_announcement TO anon;

GRANT SELECT ON public.admin_announcement TO authenticated;

GRANT UPDATE ON public.admin_announcement TO authenticated;

GRANT TRUNCATE ON public.admin_announcement TO authenticated;

GRANT REFERENCES ON public.admin_announcement TO authenticated;

GRANT TRIGGER ON public.admin_announcement TO authenticated;

GRANT INSERT ON public.admin_announcement TO service_role;

GRANT SELECT ON public.admin_announcement TO service_role;

GRANT UPDATE ON public.admin_announcement TO service_role;

GRANT DELETE ON public.admin_announcement TO service_role;

GRANT TRUNCATE ON public.admin_announcement TO service_role;

GRANT REFERENCES ON public.admin_announcement TO service_role;

GRANT TRIGGER ON public.admin_announcement TO service_role;

GRANT SELECT ON public.course_cancellation_responses TO anon;

GRANT UPDATE ON public.course_cancellation_responses TO anon;

GRANT TRUNCATE ON public.course_cancellation_responses TO anon;

GRANT REFERENCES ON public.course_cancellation_responses TO anon;

GRANT TRIGGER ON public.course_cancellation_responses TO anon;

GRANT INSERT ON public.course_cancellation_responses TO authenticated;

GRANT SELECT ON public.course_cancellation_responses TO authenticated;

GRANT UPDATE ON public.course_cancellation_responses TO authenticated;

GRANT DELETE ON public.course_cancellation_responses TO authenticated;

GRANT TRUNCATE ON public.course_cancellation_responses TO authenticated;

GRANT REFERENCES ON public.course_cancellation_responses TO authenticated;

GRANT TRIGGER ON public.course_cancellation_responses TO authenticated;

GRANT INSERT ON public.course_cancellation_responses TO service_role;

GRANT SELECT ON public.course_cancellation_responses TO service_role;

GRANT UPDATE ON public.course_cancellation_responses TO service_role;

GRANT DELETE ON public.course_cancellation_responses TO service_role;

GRANT TRUNCATE ON public.course_cancellation_responses TO service_role;

GRANT REFERENCES ON public.course_cancellation_responses TO service_role;

GRANT TRIGGER ON public.course_cancellation_responses TO service_role;

GRANT TRUNCATE ON public.profiles TO anon;

GRANT REFERENCES ON public.profiles TO anon;

GRANT TRIGGER ON public.profiles TO anon;

GRANT INSERT ON public.profiles TO authenticated;

GRANT SELECT ON public.profiles TO authenticated;

GRANT DELETE ON public.profiles TO authenticated;

GRANT TRUNCATE ON public.profiles TO authenticated;

GRANT REFERENCES ON public.profiles TO authenticated;

GRANT TRIGGER ON public.profiles TO authenticated;

GRANT INSERT ON public.profiles TO service_role;

GRANT SELECT ON public.profiles TO service_role;

GRANT UPDATE ON public.profiles TO service_role;

GRANT DELETE ON public.profiles TO service_role;

GRANT TRUNCATE ON public.profiles TO service_role;

GRANT REFERENCES ON public.profiles TO service_role;

GRANT TRIGGER ON public.profiles TO service_role;

GRANT TRUNCATE ON public.credits TO anon;

GRANT REFERENCES ON public.credits TO anon;

GRANT TRIGGER ON public.credits TO anon;

GRANT INSERT ON public.credits TO authenticated;

GRANT SELECT ON public.credits TO authenticated;

GRANT UPDATE ON public.credits TO authenticated;

GRANT DELETE ON public.credits TO authenticated;

GRANT TRUNCATE ON public.credits TO authenticated;

GRANT REFERENCES ON public.credits TO authenticated;

GRANT TRIGGER ON public.credits TO authenticated;

GRANT INSERT ON public.credits TO service_role;

GRANT SELECT ON public.credits TO service_role;

GRANT UPDATE ON public.credits TO service_role;

GRANT DELETE ON public.credits TO service_role;

GRANT TRUNCATE ON public.credits TO service_role;

GRANT REFERENCES ON public.credits TO service_role;

GRANT TRIGGER ON public.credits TO service_role;

GRANT TRUNCATE ON public.enrollments TO anon;

GRANT REFERENCES ON public.enrollments TO anon;

GRANT TRIGGER ON public.enrollments TO anon;

GRANT INSERT ON public.enrollments TO authenticated;

GRANT SELECT ON public.enrollments TO authenticated;

GRANT UPDATE ON public.enrollments TO authenticated;

GRANT DELETE ON public.enrollments TO authenticated;

GRANT TRUNCATE ON public.enrollments TO authenticated;

GRANT REFERENCES ON public.enrollments TO authenticated;

GRANT TRIGGER ON public.enrollments TO authenticated;

GRANT INSERT ON public.enrollments TO service_role;

GRANT SELECT ON public.enrollments TO service_role;

GRANT UPDATE ON public.enrollments TO service_role;

GRANT DELETE ON public.enrollments TO service_role;

GRANT TRUNCATE ON public.enrollments TO service_role;

GRANT REFERENCES ON public.enrollments TO service_role;

GRANT TRIGGER ON public.enrollments TO service_role;

GRANT TRUNCATE ON public.waitlist TO anon;

GRANT REFERENCES ON public.waitlist TO anon;

GRANT TRIGGER ON public.waitlist TO anon;

GRANT INSERT ON public.waitlist TO authenticated;

GRANT SELECT ON public.waitlist TO authenticated;

GRANT UPDATE ON public.waitlist TO authenticated;

GRANT DELETE ON public.waitlist TO authenticated;

GRANT TRUNCATE ON public.waitlist TO authenticated;

GRANT REFERENCES ON public.waitlist TO authenticated;

GRANT TRIGGER ON public.waitlist TO authenticated;

GRANT INSERT ON public.waitlist TO service_role;

GRANT SELECT ON public.waitlist TO service_role;

GRANT UPDATE ON public.waitlist TO service_role;

GRANT DELETE ON public.waitlist TO service_role;

GRANT TRUNCATE ON public.waitlist TO service_role;

GRANT REFERENCES ON public.waitlist TO service_role;

GRANT TRIGGER ON public.waitlist TO service_role;

GRANT TRUNCATE ON public.bookings TO anon;

GRANT REFERENCES ON public.bookings TO anon;

GRANT TRIGGER ON public.bookings TO anon;

GRANT INSERT ON public.bookings TO authenticated;

GRANT SELECT ON public.bookings TO authenticated;

GRANT UPDATE ON public.bookings TO authenticated;

GRANT DELETE ON public.bookings TO authenticated;

GRANT TRUNCATE ON public.bookings TO authenticated;

GRANT REFERENCES ON public.bookings TO authenticated;

GRANT TRIGGER ON public.bookings TO authenticated;

GRANT INSERT ON public.bookings TO service_role;

GRANT SELECT ON public.bookings TO service_role;

GRANT UPDATE ON public.bookings TO service_role;

GRANT DELETE ON public.bookings TO service_role;

GRANT TRUNCATE ON public.bookings TO service_role;

GRANT REFERENCES ON public.bookings TO service_role;

GRANT TRIGGER ON public.bookings TO service_role;

GRANT SELECT ON public.invitations TO anon;

GRANT TRUNCATE ON public.invitations TO anon;

GRANT REFERENCES ON public.invitations TO anon;

GRANT TRIGGER ON public.invitations TO anon;

GRANT INSERT ON public.invitations TO authenticated;

GRANT SELECT ON public.invitations TO authenticated;

GRANT UPDATE ON public.invitations TO authenticated;

GRANT DELETE ON public.invitations TO authenticated;

GRANT TRUNCATE ON public.invitations TO authenticated;

GRANT REFERENCES ON public.invitations TO authenticated;

GRANT TRIGGER ON public.invitations TO authenticated;

GRANT INSERT ON public.invitations TO service_role;

GRANT SELECT ON public.invitations TO service_role;

GRANT UPDATE ON public.invitations TO service_role;

GRANT DELETE ON public.invitations TO service_role;

GRANT TRUNCATE ON public.invitations TO service_role;

GRANT REFERENCES ON public.invitations TO service_role;

GRANT TRIGGER ON public.invitations TO service_role;

GRANT TRUNCATE ON public.sessions TO anon;

GRANT REFERENCES ON public.sessions TO anon;

GRANT TRIGGER ON public.sessions TO anon;

GRANT INSERT ON public.sessions TO authenticated;

GRANT SELECT ON public.sessions TO authenticated;

GRANT UPDATE ON public.sessions TO authenticated;

GRANT DELETE ON public.sessions TO authenticated;

GRANT TRUNCATE ON public.sessions TO authenticated;

GRANT REFERENCES ON public.sessions TO authenticated;

GRANT TRIGGER ON public.sessions TO authenticated;

GRANT INSERT ON public.sessions TO service_role;

GRANT SELECT ON public.sessions TO service_role;

GRANT UPDATE ON public.sessions TO service_role;

GRANT DELETE ON public.sessions TO service_role;

GRANT TRUNCATE ON public.sessions TO service_role;

GRANT REFERENCES ON public.sessions TO service_role;

GRANT TRIGGER ON public.sessions TO service_role;

GRANT TRUNCATE ON public.waitlist_offers TO anon;

GRANT REFERENCES ON public.waitlist_offers TO anon;

GRANT TRIGGER ON public.waitlist_offers TO anon;

GRANT INSERT ON public.waitlist_offers TO authenticated;

GRANT SELECT ON public.waitlist_offers TO authenticated;

GRANT UPDATE ON public.waitlist_offers TO authenticated;

GRANT TRUNCATE ON public.waitlist_offers TO authenticated;

GRANT REFERENCES ON public.waitlist_offers TO authenticated;

GRANT TRIGGER ON public.waitlist_offers TO authenticated;

GRANT INSERT ON public.waitlist_offers TO service_role;

GRANT SELECT ON public.waitlist_offers TO service_role;

GRANT UPDATE ON public.waitlist_offers TO service_role;

GRANT DELETE ON public.waitlist_offers TO service_role;

GRANT TRUNCATE ON public.waitlist_offers TO service_role;

GRANT REFERENCES ON public.waitlist_offers TO service_role;

GRANT TRIGGER ON public.waitlist_offers TO service_role;

GRANT TRUNCATE ON public.audit_log TO anon;

GRANT REFERENCES ON public.audit_log TO anon;

GRANT TRIGGER ON public.audit_log TO anon;

GRANT INSERT ON public.audit_log TO authenticated;

GRANT SELECT ON public.audit_log TO authenticated;

GRANT UPDATE ON public.audit_log TO authenticated;

GRANT DELETE ON public.audit_log TO authenticated;

GRANT TRUNCATE ON public.audit_log TO authenticated;

GRANT REFERENCES ON public.audit_log TO authenticated;

GRANT TRIGGER ON public.audit_log TO authenticated;

GRANT INSERT ON public.audit_log TO service_role;

GRANT SELECT ON public.audit_log TO service_role;

GRANT UPDATE ON public.audit_log TO service_role;

GRANT DELETE ON public.audit_log TO service_role;

GRANT TRUNCATE ON public.audit_log TO service_role;

GRANT REFERENCES ON public.audit_log TO service_role;

GRANT TRIGGER ON public.audit_log TO service_role;

GRANT TRUNCATE ON public.notification_log TO anon;

GRANT REFERENCES ON public.notification_log TO anon;

GRANT TRIGGER ON public.notification_log TO anon;

GRANT INSERT ON public.notification_log TO authenticated;

GRANT SELECT ON public.notification_log TO authenticated;

GRANT TRUNCATE ON public.notification_log TO authenticated;

GRANT REFERENCES ON public.notification_log TO authenticated;

GRANT TRIGGER ON public.notification_log TO authenticated;

GRANT INSERT ON public.notification_log TO service_role;

GRANT SELECT ON public.notification_log TO service_role;

GRANT UPDATE ON public.notification_log TO service_role;

GRANT DELETE ON public.notification_log TO service_role;

GRANT TRUNCATE ON public.notification_log TO service_role;

GRANT REFERENCES ON public.notification_log TO service_role;

GRANT TRIGGER ON public.notification_log TO service_role;

GRANT TRUNCATE ON public.legal_acceptances TO anon;

GRANT REFERENCES ON public.legal_acceptances TO anon;

GRANT TRIGGER ON public.legal_acceptances TO anon;

GRANT INSERT ON public.legal_acceptances TO authenticated;

GRANT SELECT ON public.legal_acceptances TO authenticated;

GRANT UPDATE ON public.legal_acceptances TO authenticated;

GRANT DELETE ON public.legal_acceptances TO authenticated;

GRANT TRUNCATE ON public.legal_acceptances TO authenticated;

GRANT REFERENCES ON public.legal_acceptances TO authenticated;

GRANT TRIGGER ON public.legal_acceptances TO authenticated;

GRANT INSERT ON public.legal_acceptances TO service_role;

GRANT SELECT ON public.legal_acceptances TO service_role;

GRANT UPDATE ON public.legal_acceptances TO service_role;

GRANT DELETE ON public.legal_acceptances TO service_role;

GRANT TRUNCATE ON public.legal_acceptances TO service_role;

GRANT REFERENCES ON public.legal_acceptances TO service_role;

GRANT TRIGGER ON public.legal_acceptances TO service_role;

GRANT SELECT ON public.courses TO anon;

GRANT TRUNCATE ON public.courses TO anon;

GRANT REFERENCES ON public.courses TO anon;

GRANT TRIGGER ON public.courses TO anon;

GRANT INSERT ON public.courses TO authenticated;

GRANT SELECT ON public.courses TO authenticated;

GRANT UPDATE ON public.courses TO authenticated;

GRANT DELETE ON public.courses TO authenticated;

GRANT TRUNCATE ON public.courses TO authenticated;

GRANT REFERENCES ON public.courses TO authenticated;

GRANT TRIGGER ON public.courses TO authenticated;

GRANT INSERT ON public.courses TO service_role;

GRANT SELECT ON public.courses TO service_role;

GRANT UPDATE ON public.courses TO service_role;

GRANT DELETE ON public.courses TO service_role;

GRANT TRUNCATE ON public.courses TO service_role;

GRANT REFERENCES ON public.courses TO service_role;

GRANT TRIGGER ON public.courses TO service_role;

GRANT TRUNCATE ON public.admin_notifications TO anon;

GRANT REFERENCES ON public.admin_notifications TO anon;

GRANT TRIGGER ON public.admin_notifications TO anon;

GRANT INSERT ON public.admin_notifications TO authenticated;

GRANT SELECT ON public.admin_notifications TO authenticated;

GRANT UPDATE ON public.admin_notifications TO authenticated;

GRANT DELETE ON public.admin_notifications TO authenticated;

GRANT TRUNCATE ON public.admin_notifications TO authenticated;
