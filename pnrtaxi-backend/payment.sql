-- ============================================================
--  payment.sql — Système de paiement PNR TAXI
--  À coller dans : Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── 1. Table de configuration globale ───────────────────────
CREATE TABLE IF NOT EXISTS public.app_config (
  cle    TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
);

-- Valeurs par défaut
INSERT INTO public.app_config (cle, valeur) VALUES
  ('gratuite_active',    'true'),
  ('gratuite_duree_mois','1'),
  ('tarif_journee',      '500'),
  ('tarif_semaine',      '1000')
ON CONFLICT (cle) DO NOTHING;

-- Sécurité
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Config lecture publique" ON public.app_config;
DROP POLICY IF EXISTS "Config mise à jour" ON public.app_config;

CREATE POLICY "Config lecture publique"
  ON public.app_config FOR SELECT USING (true);

CREATE POLICY "Config mise à jour"
  ON public.app_config FOR UPDATE USING (true) WITH CHECK (true);


-- ── 2. Table des accès drivers ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.driver_access (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       TEXT        NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  type            TEXT        NOT NULL CHECK (type IN ('gratuit', 'journee', 'semaine')),
  montant         INTEGER     NOT NULL DEFAULT 0,
  date_debut      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  date_expiration TIMESTAMPTZ NOT NULL,
  statut          TEXT        NOT NULL DEFAULT 'actif'
                              CHECK (statut IN ('actif', 'expire', 'en_attente')),
  ref_paiement    TEXT,
  operateur       TEXT        CHECK (operateur IN ('mtn', 'airtel')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_driver_access_driver_id
  ON public.driver_access(driver_id);

CREATE INDEX IF NOT EXISTS idx_driver_access_statut
  ON public.driver_access(statut);

CREATE INDEX IF NOT EXISTS idx_driver_access_expiration
  ON public.driver_access(date_expiration);

-- Sécurité
ALTER TABLE public.driver_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Accès lecture publique"  ON public.driver_access;
DROP POLICY IF EXISTS "Accès insertion"         ON public.driver_access;
DROP POLICY IF EXISTS "Accès mise à jour"       ON public.driver_access;

CREATE POLICY "Accès lecture publique"
  ON public.driver_access FOR SELECT USING (true);

CREATE POLICY "Accès insertion"
  ON public.driver_access FOR INSERT WITH CHECK (true);

CREATE POLICY "Accès mise à jour"
  ON public.driver_access FOR UPDATE USING (true) WITH CHECK (true);


-- ── 3. Temps réel sur driver_access ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'driver_access'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_access;
  END IF;
END $$;

-- ── 3b. Temps réel sur app_config ───────────────────────────
-- Nécessaire pour que les drivers reçoivent les changements de config en temps réel
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'app_config'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_config;
  END IF;
END $$;

-- ── 4. Activer REPLICA IDENTITY pour les filtres Realtime ───
ALTER TABLE public.driver_access REPLICA IDENTITY FULL;
ALTER TABLE public.app_config    REPLICA IDENTITY FULL;

-- ── 5. Vérification ─────────────────────────────────────────
SELECT cle, valeur FROM public.app_config ORDER BY cle;
