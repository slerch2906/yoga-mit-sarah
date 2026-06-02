-- Sarah 2026-06-02: Neu-Yogi-Hinweis ("Sarah traegt dich nach der Bezahlung in
-- einen Kurs ein") Wegklicken dauerhaft + geraeteuebergreifend pro Yogi merken.
-- Vorher nur in localStorage -> beim Logout (localStorage.clear) oder auf einem
-- anderen Geraet/Browser kam der gelbe Hinweis immer wieder. Jetzt im Profil.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS new_yogi_hint_dismissed boolean NOT NULL DEFAULT false;
