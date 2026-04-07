-- ============================================================
--  ratings.sql — Système d'évaluation PNR Taxi
--  À coller dans : Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── 1. Ajouter le statut 'completed' aux courses ─────────────
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_status_check;
ALTER TABLE rides ADD CONSTRAINT rides_status_check
  CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'completed'));

-- ── 2. Table des évaluations ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ratings (
  id         UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  ride_id    UUID    NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  from_role  TEXT    NOT NULL CHECK (from_role IN ('passenger', 'driver')),
  to_id      TEXT    NOT NULL,      -- id du chauffeur ou téléphone/email du passager
  score      SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment    TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(ride_id, from_role)        -- une seule note par rôle par course
);

ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ratings_all" ON ratings FOR ALL USING (true) WITH CHECK (true);

-- ── 3. Colonnes de note moyenne sur drivers ───────────────────
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS rating_avg   NUMERIC(3,2) DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS rating_count INT          DEFAULT 0;

-- ── 4. Colonnes de note moyenne sur passengers ────────────────
ALTER TABLE passengers
  ADD COLUMN IF NOT EXISTS rating_avg   NUMERIC(3,2) DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS rating_count INT          DEFAULT 0;

-- ── 5. Fonction de mise à jour automatique des moyennes ───────
CREATE OR REPLACE FUNCTION update_rating_avg()
RETURNS TRIGGER AS $$
BEGIN
  -- Passager note un chauffeur → mettre à jour drivers
  IF NEW.from_role = 'passenger' THEN
    UPDATE drivers
    SET
      rating_avg   = (SELECT ROUND(AVG(score)::NUMERIC, 2) FROM ratings WHERE to_id = NEW.to_id AND from_role = 'passenger'),
      rating_count = (SELECT COUNT(*) FROM ratings WHERE to_id = NEW.to_id AND from_role = 'passenger')
    WHERE id = NEW.to_id;
  END IF;

  -- Chauffeur note un passager → mettre à jour passengers
  IF NEW.from_role = 'driver' THEN
    UPDATE passengers
    SET
      rating_avg   = (SELECT ROUND(AVG(score)::NUMERIC, 2) FROM ratings WHERE to_id = NEW.to_id AND from_role = 'driver'),
      rating_count = (SELECT COUNT(*) FROM ratings WHERE to_id = NEW.to_id AND from_role = 'driver')
    WHERE telephone = NEW.to_id OR email = NEW.to_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ratings_update_avg ON ratings;
CREATE TRIGGER ratings_update_avg
  AFTER INSERT OR UPDATE ON ratings
  FOR EACH ROW EXECUTE FUNCTION update_rating_avg();

-- ── Vérification ──────────────────────────────────────────────
SELECT 'Système d''évaluation créé ✅' AS statut;
