-- Neue Absage-Option "Kurscredits reduzieren" (Sarah 2026-08-18):
-- Wenn eine Kursstunde ohne Ersatztermin und OHNE Credit-Rückbuchung
-- abgesagt wird (z.B. Krankheit ohne Ersatz), sollen die betroffenen
-- Kurs-Credits stattdessen dauerhaft um 1 sinken (total -1), statt dass
-- die Yogis eine zusätzliche freie Stunde gutgeschrieben bekommen.
--
-- Dieses Flag markiert genau diese Absage-Art auf der Session, damit die
-- Admin-Kursübersicht ein eigenes Label zeigen kann und "Ersatztermin
-- nachträglich anlegen" für diese Sessions ausgeblendet werden kann
-- (sonst würde total dauerhaft zu niedrig bleiben, obwohl die Stunde
-- doch noch nachgeholt wird).
ALTER TABLE public.sessions
  ADD COLUMN credit_reduced_on_cancel boolean NOT NULL DEFAULT false;
