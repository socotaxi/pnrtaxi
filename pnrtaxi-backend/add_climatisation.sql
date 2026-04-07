-- ============================================================
--  add_climatisation.sql — Ajout du champ climatisation
--  À coller dans : Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Ajouter la colonne à la table drivers (si elle n'existe pas)
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS climatisation BOOLEAN DEFAULT false;

-- 2. Mettre à jour la fonction register_driver pour accepter p_climatisation
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
  p_password           TEXT    DEFAULT NULL,
  p_climatisation      BOOLEAN DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.drivers (
    id, telephone, prenom, nom, photo, verified,
    type_vehicule, marque, modele, couleur, immatriculation, etat_vehicule, cylindree,
    climatisation,
    permis_pays, permis_nom, permis_prenom, permis_numero, permis_date_emission, permis_photo,
    password_hash
  )
  VALUES (
    p_telephone, p_telephone, p_prenom, p_nom, p_photo, true,
    p_type_vehicule, p_marque, p_modele, p_couleur, p_immatriculation, p_etat_vehicule, p_cylindree,
    p_climatisation,
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
    climatisation        = EXCLUDED.climatisation,
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

-- 3. Droits d'exécution (19 params)
GRANT EXECUTE ON FUNCTION public.register_driver(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN
) TO anon;
GRANT EXECUTE ON FUNCTION public.register_driver(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN
) TO authenticated;

SELECT 'Colonne climatisation ajoutée + fonction register_driver mise à jour ✅' AS statut;
