-- ============================================================
--  fix_rls_oauth.sql — Correctifs RLS pour les users OAuth
--  Problème : passenger_id stocké comme email pour les users
--  Google/Facebook, mais la policy rides vérifie auth.uid()::text
--  (UUID). Les deux ne matchent jamais → 403.
--
--  À coller dans : Supabase Dashboard → SQL Editor → New query
-- ============================================================


-- ══════════════════════════════════════════════════════════════
--  FIX 1 : rides — SELECT
--  Ajouter la comparaison par email en plus de auth.uid()
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "rides_select_participants_or_admin" ON rides;

CREATE POLICY "rides_select_participants_or_admin"
  ON rides FOR SELECT
  USING (
    passenger_id = auth.uid()::text
    OR passenger_id = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR driver_id   = (SELECT phone FROM auth.users WHERE id = auth.uid())
    OR public.is_admin()
  );


-- ══════════════════════════════════════════════════════════════
--  FIX 2 : rides — INSERT
--  Permettre à un user OAuth (email comme passenger_id) de créer
--  une course. La policy actuelle vérifie auth.uid() IS NOT NULL
--  ce qui est déjà correct, mais on s'assure du DROP/RECREATE.
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "rides_insert_authenticated" ON rides;

CREATE POLICY "rides_insert_authenticated"
  ON rides FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);


-- ══════════════════════════════════════════════════════════════
--  FIX 3 : rides — UPDATE
--  Ajouter la comparaison par email pour le chauffeur (cohérence)
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "rides_update_driver_or_admin" ON rides;

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
--  FIX 4 : passengers — INSERT ouvert + UPDATE ouvert pour upsert
--  Le upsert OAuth échoue (403) car PostgREST vérifie BOTH
--  INSERT et UPDATE policies même si le row n'existe pas encore.
--  UPDATE policy requiert auth.uid() → peut échouer si le JWT
--  n'est pas encore attaché au moment du premier login.
--  Solution : rendre l'INSERT + UPDATE permissifs pour les users
--  authentifiés ou pour l'insertion initiale OAuth.
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "passengers_insert_open"          ON public.passengers;
DROP POLICY IF EXISTS "passengers_update_own_or_admin"  ON public.passengers;

-- INSERT : ouvert (création de compte, pas d'auth requise)
CREATE POLICY "passengers_insert_open"
  ON public.passengers FOR INSERT
  WITH CHECK (true);

-- UPDATE : son propre enregistrement (par téléphone OU email OU UUID) ou admin
CREATE POLICY "passengers_update_own_or_admin"
  ON public.passengers FOR UPDATE
  USING (
    telephone = (SELECT phone  FROM auth.users WHERE id = auth.uid())
    OR email  = (SELECT email  FROM auth.users WHERE id = auth.uid())
    OR id::text = auth.uid()::text
    OR public.is_admin()
  )
  WITH CHECK (
    telephone = (SELECT phone  FROM auth.users WHERE id = auth.uid())
    OR email  = (SELECT email  FROM auth.users WHERE id = auth.uid())
    OR id::text = auth.uid()::text
    OR public.is_admin()
  );


-- ══════════════════════════════════════════════════════════════
--  FIX 5 : passengers — SELECT
--  Permettre la lecture par email ou téléphone pour tout user
--  authentifié dont l'identifiant correspond.
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "passengers_select_own_or_admin" ON public.passengers;

CREATE POLICY "passengers_select_own_or_admin"
  ON public.passengers FOR SELECT
  USING (
    telephone = (SELECT phone  FROM auth.users WHERE id = auth.uid())
    OR email  = (SELECT email  FROM auth.users WHERE id = auth.uid())
    OR id::text = auth.uid()::text
    OR public.is_admin()
  );


-- Vérification des policies actives
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('passengers', 'rides')
ORDER BY tablename, cmd;

SELECT 'Correctifs RLS OAuth appliqués ✅' AS statut;
