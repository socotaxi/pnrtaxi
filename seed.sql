-- ============================================================
--  seed.sql — Taxi Pointe-Noire / Supabase
--  À coller dans : Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── 1. Création de la table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.drivers (
  id          TEXT PRIMARY KEY,           -- numéro de téléphone
  nom         TEXT NOT NULL,
  photo       TEXT,
  plaque      TEXT NOT NULL,
  vehicule    TEXT,
  telephone   TEXT,
  disponible  BOOLEAN DEFAULT false,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  last_seen   TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Sécurité (Row Level Security) ────────────────────────
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

-- Lecture publique : tout le monde peut voir les chauffeurs
CREATE POLICY "Lecture publique"
  ON public.drivers FOR SELECT
  USING (true);

-- Modification libre (à restreindre avec Auth en production)
CREATE POLICY "Mise à jour libre"
  ON public.drivers FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- ── 3. Activation du temps réel ─────────────────────────────
-- Permet à l'app passager de recevoir les mises à jour live
ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;

-- ── 4. Données de démonstration ─────────────────────────────
--  6 chauffeurs fictifs avec vraies coordonnées GPS de Pointe-Noire

INSERT INTO public.drivers (id, nom, photo, plaque, vehicule, telephone, disponible, lat, lng)
VALUES
  (
    '242060000001',
    'Jean-Baptiste Mpika',
    'https://i.pravatar.cc/150?img=1',
    'PNR-1234-CG',
    'Toyota Corolla 2019',
    '242060000001',
    true,
    -4.7750,   -- Centre-ville (avenue Charles de Gaulle)
    11.8632
  ),
  (
    '242060000002',
    'Arsène Loubaki',
    'https://i.pravatar.cc/150?img=2',
    'PNR-5678-CG',
    'Hyundai Accent 2020',
    '242060000002',
    true,
    -4.7421,   -- Loandjili (proche marché)
    11.8557
  ),
  (
    '242060000003',
    'Christelle Moukoko',
    'https://i.pravatar.cc/150?img=3',
    'PNR-9012-CG',
    'Renault Logan 2021',
    '242060000003',
    false,
    -4.8011,   -- Tié-Tié
    11.8704
  ),
  (
    '242060000004',
    'Rodrigue Nkodia',
    'https://i.pravatar.cc/150?img=4',
    'PNR-3456-CG',
    'Peugeot 301 2018',
    '242060000004',
    true,
    -4.7903,   -- Mongo-Mpoukou
    11.8820
  ),
  (
    '242060000005',
    'Célestine Bouanga',
    'https://i.pravatar.cc/150?img=5',
    'PNR-7890-CG',
    'Toyota Yaris 2022',
    '242060000005',
    true,
    -4.8162,   -- Mvou-Mvou (proche aéroport)
    11.8956
  ),
  (
    '242060000006',
    'Patrick Ossoko',
    'https://i.pravatar.cc/150?img=6',
    'PNR-2468-CG',
    'Kia Rio 2020',
    '242060000006',
    false,
    -4.7253,   -- Ngoyo (nord de Pointe-Noire)
    11.8601
  )
ON CONFLICT (id) DO NOTHING;  -- Évite les doublons si on relance le script

-- ── Vérification ─────────────────────────────────────────────
SELECT id, nom, plaque, disponible, lat, lng FROM public.drivers ORDER BY created_at;
