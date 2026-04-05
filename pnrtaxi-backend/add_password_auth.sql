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
--  5. Ajouter password_hash à la table drivers
-- ============================================================
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- ============================================================
--  6. Mettre à jour register_driver pour hasher le mot de passe
--     (remplace la version à 17 params de fix_driver_rls.sql)
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_driver(
  p_telephone          TEXT,
  p_prenom             TEXT,
  p_nom                TEXT,
  p_photo              TEXT,
  p_type_vehicule      TEXT,
  p_marque             TEXT,
  p_modele             TEXT,
  p_couleur            TEXT,
  p_immatriculation    TEXT,
  p_etat_vehicule      TEXT,
  p_cylindree          TEXT,
  p_permis_pays        TEXT,
  p_permis_nom         TEXT,
  p_permis_prenom      TEXT,
  p_permis_numero      TEXT,
  p_permis_date        TEXT,
  p_permis_photo       TEXT,
  p_password           TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.drivers (
    id, telephone, prenom, nom, photo, verified,
    type_vehicule, marque, modele, couleur, immatriculation, etat_vehicule, cylindree,
    permis_pays, permis_nom, permis_prenom, permis_numero, permis_date_emission, permis_photo,
    password_hash
  )
  VALUES (
    p_telephone, p_telephone, p_prenom, p_nom, p_photo, true,
    p_type_vehicule, p_marque, p_modele, p_couleur, p_immatriculation, p_etat_vehicule, p_cylindree,
    p_permis_pays, p_permis_nom, p_permis_prenom, p_permis_numero,
    CASE WHEN p_permis_date = '' THEN NULL ELSE p_permis_date::date END,
    p_permis_photo,
    CASE
      WHEN p_password IS NOT NULL AND p_password <> ''
      THEN crypt(p_password, gen_salt('bf', 10))
      ELSE NULL
    END
  )
  ON CONFLICT (id) DO UPDATE SET
    prenom               = EXCLUDED.prenom,
    nom                  = EXCLUDED.nom,
    photo                = COALESCE(EXCLUDED.photo, public.drivers.photo),
    type_vehicule        = EXCLUDED.type_vehicule,
    marque               = EXCLUDED.marque,
    modele               = EXCLUDED.modele,
    couleur              = EXCLUDED.couleur,
    immatriculation      = EXCLUDED.immatriculation,
    etat_vehicule        = EXCLUDED.etat_vehicule,
    cylindree            = EXCLUDED.cylindree,
    permis_pays          = EXCLUDED.permis_pays,
    permis_nom           = EXCLUDED.permis_nom,
    permis_prenom        = EXCLUDED.permis_prenom,
    permis_numero        = EXCLUDED.permis_numero,
    permis_date_emission = EXCLUDED.permis_date_emission,
    permis_photo         = COALESCE(EXCLUDED.permis_photo, public.drivers.permis_photo),
    password_hash        = CASE
                             WHEN p_password IS NOT NULL AND p_password <> ''
                             THEN crypt(p_password, gen_salt('bf', 10))
                             ELSE public.drivers.password_hash
                           END,
    verified             = true;
END;
$$;

-- Redonner les droits sur la nouvelle signature (18 params)
GRANT EXECUTE ON FUNCTION public.register_driver(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) TO anon;
GRANT EXECUTE ON FUNCTION public.register_driver(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) TO authenticated;

-- ============================================================
--  7. Nouvelle RPC : vérifier téléphone + mot de passe chauffeur
-- ============================================================
CREATE OR REPLACE FUNCTION verify_driver_password(
  p_telephone TEXT,
  p_password  TEXT
)
RETURNS TABLE (
  telephone TEXT,
  prenom    TEXT,
  nom       TEXT,
  photo     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.telephone,
    d.prenom,
    d.nom,
    d.photo
  FROM drivers d
  WHERE d.telephone     = p_telephone
    AND d.password_hash IS NOT NULL
    AND d.password_hash = crypt(p_password, d.password_hash);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_driver_password(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_driver_password(TEXT, TEXT) TO authenticated;

-- ============================================================
--  8. Vérifications rapides (optionnel)
-- ============================================================
-- SELECT verify_passenger_password('+242060000001', 'monMotDePasse');
-- SELECT verify_driver_password('+242060000001', 'monMotDePasse');
