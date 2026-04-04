-- ============================================================
--  security.sql — Durcissement RLS pour la mise en production
--  À coller dans : Supabase Dashboard → SQL Editor → New query
--
--  PRÉREQUIS : Créer un compte admin dans Supabase Auth
--  (Authentication → Users → Add user) puis l'identifier ici.
--
--  Ce script remplace TOUTES les policies "USING (true)" par
--  des policies restrictives adaptées à chaque table.
-- ============================================================


-- ══════════════════════════════════════════════════════════════
--  HELPER : fonction qui vérifie si l'utilisateur courant
--  est admin (basé sur user_metadata.role = 'admin')
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin',
    false
  );
$$;


-- ══════════════════════════════════════════════════════════════
--  TABLE : drivers
--  Lecture publique OK (la carte les affiche tous)
--  Modification : seulement le chauffeur lui-même (via son téléphone
--  stocké dans auth.users.phone) OU un admin
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Lecture publique"  ON public.drivers;
DROP POLICY IF EXISTS "Mise à jour libre" ON public.drivers;

-- Lecture : tout le monde peut voir les chauffeurs disponibles
CREATE POLICY "drivers_select_public"
  ON public.drivers FOR SELECT
  USING (true);

-- Mise à jour : chauffeur lui-même ou admin
CREATE POLICY "drivers_update_own_or_admin"
  ON public.drivers FOR UPDATE
  USING (
    id = (SELECT phone FROM auth.users WHERE id = auth.uid())
    OR public.is_admin()
  )
  WITH CHECK (
    id = (SELECT phone FROM auth.users WHERE id = auth.uid())
    OR public.is_admin()
  );


-- ══════════════════════════════════════════════════════════════
--  TABLE : passengers
--  Inscription libre (INSERT) — nécessaire pour l'onboarding OTP
--  Lecture/MàJ : seulement son propre enregistrement OU admin
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Inscription libre"  ON public.passengers;
DROP POLICY IF EXISTS "Lecture propre"     ON public.passengers;
DROP POLICY IF EXISTS "Mise à jour propre" ON public.passengers;

-- INSERT libre (création de compte)
CREATE POLICY "passengers_insert_open"
  ON public.passengers FOR INSERT
  WITH CHECK (true);

-- SELECT : son propre enregistrement (par téléphone ou email) ou admin
CREATE POLICY "passengers_select_own_or_admin"
  ON public.passengers FOR SELECT
  USING (
    telephone = (SELECT phone FROM auth.users WHERE id = auth.uid())
    OR email   = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR public.is_admin()
  );

-- UPDATE : son propre enregistrement ou admin
CREATE POLICY "passengers_update_own_or_admin"
  ON public.passengers FOR UPDATE
  USING (
    telephone = (SELECT phone FROM auth.users WHERE id = auth.uid())
    OR email   = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR public.is_admin()
  )
  WITH CHECK (
    telephone = (SELECT phone FROM auth.users WHERE id = auth.uid())
    OR email   = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR public.is_admin()
  );


-- ══════════════════════════════════════════════════════════════
--  TABLE : driver_access
--  Lecture : le chauffeur concerné + admin
--  INSERT : le chauffeur lui-même (soumission paiement)
--  UPDATE : admin uniquement (validation / révocation)
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Accès lecture publique" ON public.driver_access;
DROP POLICY IF EXISTS "Accès insertion"        ON public.driver_access;
DROP POLICY IF EXISTS "Accès mise à jour"      ON public.driver_access;

-- SELECT : chauffeur concerné ou admin
CREATE POLICY "driver_access_select_own_or_admin"
  ON public.driver_access FOR SELECT
  USING (
    driver_id = (SELECT phone FROM auth.users WHERE id = auth.uid())
    OR public.is_admin()
  );

-- INSERT : chauffeur insère sa propre demande, admin peut aussi insérer
CREATE POLICY "driver_access_insert_own_or_admin"
  ON public.driver_access FOR INSERT
  WITH CHECK (
    driver_id = (SELECT phone FROM auth.users WHERE id = auth.uid())
    OR public.is_admin()
  );

-- UPDATE : admin uniquement (validation / révocation)
CREATE POLICY "driver_access_update_admin_only"
  ON public.driver_access FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- DELETE : admin uniquement (rejet d'une demande)
DROP POLICY IF EXISTS "driver_access_delete_admin_only" ON public.driver_access;
CREATE POLICY "driver_access_delete_admin_only"
  ON public.driver_access FOR DELETE
  USING (public.is_admin());


-- ══════════════════════════════════════════════════════════════
--  TABLE : app_config
--  Lecture : tout le monde (les drivers lisent les tarifs)
--  Écriture : admin uniquement
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Config lecture publique" ON public.app_config;
DROP POLICY IF EXISTS "Config mise à jour"      ON public.app_config;
DROP POLICY IF EXISTS "Config insertion"        ON public.app_config;

-- SELECT : lecture publique (tarifs affichés aux chauffeurs)
CREATE POLICY "app_config_select_public"
  ON public.app_config FOR SELECT
  USING (true);

-- INSERT / UPDATE : admin seulement
CREATE POLICY "app_config_write_admin_only"
  ON public.app_config FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "app_config_update_admin_only"
  ON public.app_config FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ══════════════════════════════════════════════════════════════
--  TABLE : rides
--  INSERT : passager authentifié
--  SELECT / UPDATE : passager concerné OU chauffeur concerné OU admin
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "rides_all" ON rides;

-- INSERT : tout utilisateur authentifié (passager crée une course)
CREATE POLICY "rides_insert_authenticated"
  ON rides FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- SELECT : passager ou chauffeur de la course, ou admin
CREATE POLICY "rides_select_participants_or_admin"
  ON rides FOR SELECT
  USING (
    passenger_id = auth.uid()::text
    OR driver_id = (SELECT phone FROM auth.users WHERE id = auth.uid())
    OR public.is_admin()
  );

-- UPDATE : chauffeur de la course (accepter/rejeter) ou admin
CREATE POLICY "rides_update_driver_or_admin"
  ON rides FOR UPDATE
  USING (
    driver_id = (SELECT phone FROM auth.users WHERE id = auth.uid())
    OR public.is_admin()
  )
  WITH CHECK (
    driver_id = (SELECT phone FROM auth.users WHERE id = auth.uid())
    OR public.is_admin()
  );


-- ══════════════════════════════════════════════════════════════
--  STORAGE : bucket avatars
--  Lecture publique OK (avatars affichés dans l'UI)
--  Upload : utilisateur authentifié, seulement son propre dossier
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Avatars lecture publique" ON storage.objects;
DROP POLICY IF EXISTS "Avatars upload libre"     ON storage.objects;
DROP POLICY IF EXISTS "Avatars update libre"     ON storage.objects;

-- Lecture publique
CREATE POLICY "avatars_select_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Upload : l'utilisateur ne peut uploader que dans son propre dossier
-- (passengers/<telephone>.ext ou drivers/<telephone>.ext)
CREATE POLICY "avatars_insert_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND (
      -- le chemin commence par passengers/<phone_de_l_user> ou drivers/<phone_de_l_user>
      name LIKE 'passengers/' || (SELECT phone FROM auth.users WHERE id = auth.uid()) || '.%'
      OR name LIKE 'drivers/'  || (SELECT phone FROM auth.users WHERE id = auth.uid()) || '.%'
      OR public.is_admin()
    )
  );

CREATE POLICY "avatars_update_own"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND (
      name LIKE 'passengers/' || (SELECT phone FROM auth.users WHERE id = auth.uid()) || '.%'
      OR name LIKE 'drivers/'  || (SELECT phone FROM auth.users WHERE id = auth.uid()) || '.%'
      OR public.is_admin()
    )
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND (
      name LIKE 'passengers/' || (SELECT phone FROM auth.users WHERE id = auth.uid()) || '.%'
      OR name LIKE 'drivers/'  || (SELECT phone FROM auth.users WHERE id = auth.uid()) || '.%'
      OR public.is_admin()
    )
  );


-- ══════════════════════════════════════════════════════════════
--  CRÉER LE COMPTE ADMIN
--  Après avoir créé le compte dans Supabase Auth (UI ou API),
--  exécuter cette requête en remplaçant l'email :
-- ══════════════════════════════════════════════════════════════
-- UPDATE auth.users
-- SET raw_user_meta_data = raw_user_meta_data || '{"role": "admin"}'::jsonb
-- WHERE email = 'votre-email-admin@example.com';

SELECT 'Politiques RLS de production appliquées ✅' AS statut;
