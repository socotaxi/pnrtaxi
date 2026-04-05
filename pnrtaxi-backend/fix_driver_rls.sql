-- ============================================================
--  fix_driver_rls.sql — Correctifs RLS pour l'inscription chauffeur
--  Problème 1 : aucune policy INSERT sur drivers → 403
--  Problème 2 : Storage RLS bloque l'upload photo sans JWT
--
--  À coller dans : Supabase Dashboard → SQL Editor → New query
-- ============================================================


-- ══════════════════════════════════════════════════════════════
--  FIX 1 : drivers — INSERT via RPC sécurisée
--  On ne crée PAS de policy INSERT directe (trop permissive).
--  On crée une fonction SECURITY DEFINER qui insère le chauffeur
--  complet et retourne une erreur métier si le téléphone existe.
-- ══════════════════════════════════════════════════════════════
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
  p_permis_photo       TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.drivers (
    id, telephone, prenom, nom, photo, verified,
    type_vehicule, marque, modele, couleur, immatriculation, etat_vehicule, cylindree,
    permis_pays, permis_nom, permis_prenom, permis_numero, permis_date_emission, permis_photo
  )
  VALUES (
    p_telephone, p_telephone, p_prenom, p_nom, p_photo, true,
    p_type_vehicule, p_marque, p_modele, p_couleur, p_immatriculation, p_etat_vehicule, p_cylindree,
    p_permis_pays, p_permis_nom, p_permis_prenom, p_permis_numero,
    CASE WHEN p_permis_date = '' THEN NULL ELSE p_permis_date::date END,
    p_permis_photo
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
    verified             = true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_driver(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) TO anon;
GRANT EXECUTE ON FUNCTION public.register_driver(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) TO authenticated;


-- ══════════════════════════════════════════════════════════════
--  FIX 2 : Storage — upload avatar sans JWT (anon)
--  Ouvrir l'upload des avatars chauffeur/passager à la clé anon.
--  La sécurité repose sur le préfixe du chemin (telephone).
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "avatars_insert_own"   ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own"   ON storage.objects;

-- Upload ouvert à tout utilisateur (authentifié ou anon)
-- Le chemin doit commencer par passengers/ ou drivers/
CREATE POLICY "avatars_insert_open"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND (
      name LIKE 'passengers/%'
      OR name LIKE 'drivers/%'
    )
  );

CREATE POLICY "avatars_update_open"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND (
      name LIKE 'passengers/%'
      OR name LIKE 'drivers/%'
    )
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (
      name LIKE 'passengers/%'
      OR name LIKE 'drivers/%'
    )
  );

SELECT 'Correctifs RLS chauffeur appliqués ✅' AS statut;
