-- ============================================================
--  rides.sql — Table des courses PNR Taxi
--  Statuts : pending | accepted | rejected | cancelled
-- ============================================================

CREATE TABLE IF NOT EXISTS rides (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  passenger_id  TEXT NOT NULL,
  driver_id     TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  passenger_lat DOUBLE PRECISION,
  passenger_lng DOUBLE PRECISION,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS rides_driver_id_idx    ON rides(driver_id);
CREATE INDEX IF NOT EXISTS rides_passenger_id_idx ON rides(passenger_id);
CREATE INDEX IF NOT EXISTS rides_status_idx       ON rides(status);

-- Activer RLS
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;

-- Politique permissive (à restreindre en production)
CREATE POLICY "rides_all" ON rides FOR ALL USING (true) WITH CHECK (true);

-- Activer le temps réel Supabase
ALTER PUBLICATION supabase_realtime ADD TABLE rides;

-- Fonction pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_rides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rides_updated_at
  BEFORE UPDATE ON rides
  FOR EACH ROW EXECUTE FUNCTION update_rides_updated_at();
