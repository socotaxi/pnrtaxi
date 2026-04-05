-- ============================================================
--  MIGRATION : Authentification par mot de passe
--  À exécuter dans Supabase → SQL Editor
--  Ordre : exécuter une seule fois, de haut en bas
-- ============================================================

-- 1. Activer pgcrypto (hash bcrypt côté serveur)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Ajouter la colonne password_hash à la table passengers
ALTER TABLE passengers
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- ============================================================
--  3. Mettre à jour upsert_passenger pour accepter un mot de passe
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_passenger(
  p_telephone TEXT,
  p_prenom    TEXT,
  p_nom       TEXT,
  p_quartier  TEXT    DEFAULT '',
  p_ville     TEXT    DEFAULT '',
  p_password  TEXT    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO passengers (telephone, prenom, nom, quartier, ville, password_hash, verified)
  VALUES (
    p_telephone,
    p_prenom,
    p_nom,
    p_quartier,
    p_ville,
    CASE
      WHEN p_password IS NOT NULL AND p_password <> ''
      THEN crypt(p_password, gen_salt('bf', 10))
      ELSE NULL
    END,
    true
  )
  ON CONFLICT (telephone) DO UPDATE SET
    prenom        = EXCLUDED.prenom,
    nom           = EXCLUDED.nom,
    quartier      = EXCLUDED.quartier,
    ville         = EXCLUDED.ville,
    password_hash = CASE
                      WHEN p_password IS NOT NULL AND p_password <> ''
                      THEN crypt(p_password, gen_salt('bf', 10))
                      ELSE passengers.password_hash
                    END,
    verified      = true;
END;
$$;

-- ============================================================
--  4. Nouvelle RPC : vérifier téléphone + mot de passe
--     Retourne le profil si correct, vide sinon
-- ============================================================
CREATE OR REPLACE FUNCTION verify_passenger_password(
  p_telephone TEXT,
  p_password  TEXT
)
RETURNS TABLE (
  telephone     TEXT,
  prenom        TEXT,
  nom           TEXT,
  email         TEXT,
  auth_provider TEXT,
  avatar_url    TEXT,
  quartier      TEXT,
  ville         TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.telephone,
    p.prenom,
    p.nom,
    p.email,
    p.auth_provider,
    p.avatar_url,
    p.quartier,
    p.ville
  FROM passengers p
  WHERE p.telephone    = p_telephone
    AND p.password_hash IS NOT NULL
    AND p.password_hash = crypt(p_password, p.password_hash);
END;
$$;

-- ============================================================
--  5. Vérification rapide (optionnel)
-- ============================================================
-- SELECT verify_passenger_password('+242060000001', 'monMotDePasse');
