-- ============================================================
--  passengers.sql — Table passagers PNR Taxi
--  À coller dans : Supabase Dashboard → SQL Editor → New query
-- ============================================================

CREATE TABLE IF NOT EXISTS public.passengers (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  telephone     TEXT UNIQUE NOT NULL,
  prenom        TEXT,
  otp           TEXT,
  otp_expires_at TIMESTAMPTZ,
  verified      BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.passengers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Inscription libre"  ON public.passengers;
DROP POLICY IF EXISTS "Lecture propre"     ON public.passengers;
DROP POLICY IF EXISTS "Mise à jour propre" ON public.passengers;

CREATE POLICY "Inscription libre"  ON public.passengers FOR INSERT WITH CHECK (true);
CREATE POLICY "Lecture propre"     ON public.passengers FOR SELECT USING (true);
CREATE POLICY "Mise à jour propre" ON public.passengers FOR UPDATE USING (true) WITH CHECK (true);

-- ── Migration OAuth ──────────────────────────────────────────
-- Rendre telephone nullable (pour les utilisateurs OAuth)
ALTER TABLE public.passengers
  ALTER COLUMN telephone DROP NOT NULL;

-- Colonnes OAuth
ALTER TABLE public.passengers
  ADD COLUMN IF NOT EXISTS email          TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS auth_provider  TEXT;

-- Colonne avatar
ALTER TABLE public.passengers
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Vérification
SELECT 'Table passengers créée / migrée ✅' AS statut;
