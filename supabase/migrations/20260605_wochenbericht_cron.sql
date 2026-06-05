-- Wochenbericht (Sarah 2026-06-05): zwei pg_cron-Jobs, die die additive, read-only
-- Edge-Funktion wochenbericht-export anstossen (per pg_net). Beide ueberschreiben/
-- erzeugen nur Dateien im privaten Google-Drive-Ordner — kein Eingriff in App-Workflows.
-- Authorization nutzt den OEFFENTLICHEN anon-Key (kein Geheimnis).
-- Zeitzonen-Hinweis: pg_cron laeuft in UTC. 16:00 UTC = 18:00 Berlin (Sommer) / 17:00 (Winter);
-- 05:00 UTC = 07:00 Berlin (Sommer) / 06:00 (Winter).

-- Taeglich 07:00 Berlin: EINE Datei "Yoga-Bericht AKTUELL" (frisch ersetzt, kein Anhaeufen).
select cron.schedule(
  'wochenbericht-taeglich-aktuell-07',
  '0 5 * * *',
  $job$
  select net.http_post(
    url := 'https://jcczvyablgdijeiyymhc.supabase.co/functions/v1/wochenbericht-export?mode=aktuell',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjY3p2eWFibGdkaWplaXl5bWhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NjY0ODgsImV4cCI6MjA5NDM0MjQ4OH0.wXp5N6JPo0ACImXyTWP5Bd9j-0HDtblbGBtaD8pPFso',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $job$
);

-- Freitag 18:00 Berlin: NEUE, datierte Archiv-Datei "Wochenbericht (Stand ...)".
select cron.schedule(
  'wochenbericht-freitag-18',
  '0 16 * * 5',
  $job$
  select net.http_post(
    url := 'https://jcczvyablgdijeiyymhc.supabase.co/functions/v1/wochenbericht-export',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjY3p2eWFibGdkaWplaXl5bWhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NjY0ODgsImV4cCI6MjA5NDM0MjQ4OH0.wXp5N6JPo0ACImXyTWP5Bd9j-0HDtblbGBtaD8pPFso',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $job$
);
