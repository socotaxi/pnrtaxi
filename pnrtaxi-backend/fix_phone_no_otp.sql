-- ============================================================
--  fix_phone_no_otp.sql — Auth sans OTP SMS (période d'essai)
--  Crée une fonction RPC sécurisée pour vérifier/récupérer
--  un passager par téléphone SANS ouvrir la table passengers.
--
--  À coller dans : Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Fonction : vérifier si un numéro est enregistré
-- Retourne les données du passager ou NULL
-- SECURITY DEFINER = s'exécute avec les droits postgres, bypass RLS
CREATE OR REPLACE FUNCTION public.get_passenger_by_phone(p_telephone TEXT)
RETURNS TABLE (
  telephone    TEXT,
  prenom       TEXT,
  nom          TEXT,
  email        TEXT,
  auth_provider TEXT,
  avatar_url   TEXT,
  quartier     TEXT,
  ville        TEXT,
  verified     BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT telephone, prenom, nom, email, auth_provider, avatar_url, quartier, ville, verified
  FROM public.passengers
  WHERE passengers.telephone = p_telephone
  LIMIT 1;
$$;

-- Accorder l'accès à la clé anon (frontend)
GRANT EXECUTE ON FUNCTION public.get_passenger_by_phone(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_passenger_by_phone(TEXT) TO authenticated;

-- Fonction : créer/mettre à jour un passager (upsert)
-- Utilisée lors de l'inscription sans OTP
CREATE OR REPLACE FUNCTION public.upsert_passenger(
  p_telephone  TEXT,
  p_prenom     TEXT,
  p_nom        TEXT,
  p_quartier   TEXT,
  p_ville      TEXT
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO public.passengers (telephone, prenom, nom, quartier, ville, verified)
  VALUES (p_telephone, p_prenom, p_nom, p_quartier, p_ville, true)
  ON CONFLICT (telephone) DO UPDATE
    SET prenom   = EXCLUDED.prenom,
        nom      = EXCLUDED.nom,
        quartier = EXCLUDED.quartier,
        ville    = EXCLUDED.ville,
        verified = true;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_passenger(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.upsert_passenger(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

SELECT 'Fonctions RPC sans OTP créées ✅' AS statut;
