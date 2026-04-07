-- ============================================================
--  rate_limit.sql — Sécurisation des authentifications
--  À exécuter dans : Supabase Dashboard → SQL Editor
--
--  Ce script :
--  1. Crée une fonction get_admin_phone() — source unique du numéro admin
--  2. Crée une table login_attempts pour le rate limiting
--  3. Remplace verify_passenger_password avec rate limiting
--  4. Remplace verify_driver_password avec rate limiting
--  5. Crée verify_admin_password (numéro admin côté serveur uniquement)
--  6. Remplace update_app_config (plus de p_admin_phone côté frontend)
--  7. Remplace insert_audit_log  (plus de p_admin_phone côté frontend)
-- ============================================================

-- ── 0. Fonction helper : numéro admin centralisé ───────────────
--  Modifier ICI uniquement pour changer le numéro admin.
--  Toutes les autres fonctions appellent get_admin_phone().
CREATE OR REPLACE FUNCTION public.get_admin_phone()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT '+242050787624';
$$;

REVOKE ALL ON FUNCTION public.get_admin_phone() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_phone() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_phone() FROM authenticated;
-- Seul SECURITY DEFINER (les RPCs ci-dessous) peut appeler cette fonction.

-- ── 1. Table de rate limiting ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  telephone  TEXT        NOT NULL,
  success    BOOLEAN     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_tel_time
  ON public.login_attempts(telephone, created_at DESC);

-- Nettoyage automatique : supprimer les tentatives > 1 heure via pg_cron
-- pg_cron est disponible sur Supabase Pro. Sur Free, le bloc ci-dessous
-- est silencieusement ignoré (pas d'erreur).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'clean-login-attempts',
      '0 * * * *',
      'DELETE FROM public.login_attempts WHERE created_at < NOW() - INTERVAL ''1 hour'''
    );
  END IF;
END;
$$;

-- RLS : personne ne peut lire la table directement (SECURITY DEFINER seulement)
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
-- Pas de policy → personne sauf SECURITY DEFINER ne peut y accéder

-- ── 2. verify_passenger_password avec rate limiting ────────────
CREATE OR REPLACE FUNCTION public.verify_passenger_password(
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
SET search_path = public, extensions
AS $$
DECLARE
  v_attempts INTEGER;
BEGIN
  -- Rate limiting : max 5 échecs en 5 minutes par numéro
  SELECT COUNT(*) INTO v_attempts
  FROM public.login_attempts la
  WHERE la.telephone = p_telephone
    AND la.success   = false
    AND la.created_at > NOW() - INTERVAL '5 minutes';

  IF v_attempts >= 5 THEN
    RAISE EXCEPTION 'RATE_LIMIT_EXCEEDED';
  END IF;

  -- Vérification du mot de passe
  IF EXISTS (
    SELECT 1 FROM public.passengers p
    WHERE p.telephone    = p_telephone
      AND p.password_hash IS NOT NULL
      AND p.password_hash = crypt(p_password, p.password_hash)
  ) THEN
    -- Succès → enregistrer et retourner le profil
    INSERT INTO public.login_attempts (telephone, success) VALUES (p_telephone, true);

    RETURN QUERY
    SELECT p.telephone, p.prenom, p.nom, p.email,
           p.auth_provider, p.avatar_url, p.quartier, p.ville
    FROM public.passengers p
    WHERE p.telephone = p_telephone;
  ELSE
    -- Échec → enregistrer la tentative
    INSERT INTO public.login_attempts (telephone, success) VALUES (p_telephone, false);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_passenger_password(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_passenger_password(TEXT, TEXT) TO authenticated;


-- ── 3. verify_driver_password avec rate limiting ───────────────
CREATE OR REPLACE FUNCTION public.verify_driver_password(
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
SET search_path = public, extensions
AS $$
DECLARE
  v_attempts INTEGER;
BEGIN
  -- Rate limiting : max 5 échecs en 5 minutes par numéro
  SELECT COUNT(*) INTO v_attempts
  FROM public.login_attempts la
  WHERE la.telephone = p_telephone
    AND la.success   = false
    AND la.created_at > NOW() - INTERVAL '5 minutes';

  IF v_attempts >= 5 THEN
    RAISE EXCEPTION 'RATE_LIMIT_EXCEEDED';
  END IF;

  -- Vérification du mot de passe
  IF EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.telephone     = p_telephone
      AND d.password_hash IS NOT NULL
      AND d.password_hash = crypt(p_password, d.password_hash)
  ) THEN
    INSERT INTO public.login_attempts (telephone, success) VALUES (p_telephone, true);

    RETURN QUERY
    SELECT d.telephone, d.prenom, d.nom, d.photo
    FROM public.drivers d
    WHERE d.telephone = p_telephone;
  ELSE
    INSERT INTO public.login_attempts (telephone, success) VALUES (p_telephone, false);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_driver_password(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_driver_password(TEXT, TEXT) TO authenticated;


-- ── 4. verify_admin_password ───────────────────────────────────
--  Le numéro admin est stocké UNIQUEMENT côté serveur.
--  Le frontend appelle cette fonction et reçoit true/false.
--  Jamais besoin d'exposer le numéro dans le code JS.
CREATE OR REPLACE FUNCTION public.verify_admin_password(
  p_telephone TEXT,
  p_password  TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_admin_phone CONSTANT TEXT := public.get_admin_phone();
  v_attempts    INTEGER;
BEGIN
  -- Rate limiting : max 5 échecs en 5 minutes par numéro
  SELECT COUNT(*) INTO v_attempts
  FROM public.login_attempts la
  WHERE la.telephone = p_telephone
    AND la.success   = false
    AND la.created_at > NOW() - INTERVAL '5 minutes';

  IF v_attempts >= 5 THEN
    RAISE EXCEPTION 'RATE_LIMIT_EXCEEDED';
  END IF;

  -- Le numéro doit être celui de l'admin
  IF p_telephone != v_admin_phone THEN
    INSERT INTO public.login_attempts (telephone, success) VALUES (p_telephone, false);
    RETURN false;
  END IF;

  -- Vérification du mot de passe (via table passengers)
  IF EXISTS (
    SELECT 1 FROM public.passengers p
    WHERE p.telephone    = p_telephone
      AND p.password_hash IS NOT NULL
      AND p.password_hash = crypt(p_password, p.password_hash)
  ) THEN
    INSERT INTO public.login_attempts (telephone, success) VALUES (p_telephone, true);
    RETURN true;
  ELSE
    INSERT INTO public.login_attempts (telephone, success) VALUES (p_telephone, false);
    RETURN false;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_admin_password(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_admin_password(TEXT, TEXT) TO authenticated;


-- ── 5. update_app_config sans p_admin_phone côté frontend ──────
--  La vérification admin est interne à la fonction.
CREATE OR REPLACE FUNCTION public.update_app_config(
  p_updates     JSONB,
  p_admin_phone TEXT  -- gardé pour compatibilité, vérifié côté serveur
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_phone CONSTANT TEXT := public.get_admin_phone();
  v_cle TEXT;
  v_val TEXT;
BEGIN
  IF p_admin_phone != v_admin_phone THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  FOR v_cle, v_val IN
    SELECT key, value FROM jsonb_each_text(p_updates)
  LOOP
    INSERT INTO public.app_config (cle, valeur)
    VALUES (v_cle, v_val)
    ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_app_config(JSONB, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_app_config(JSONB, TEXT) TO authenticated;


-- ── 6. insert_audit_log sans p_admin_phone côté frontend ───────
CREATE OR REPLACE FUNCTION public.insert_audit_log(
  p_admin_phone TEXT,
  p_action      TEXT,
  p_target_id   TEXT DEFAULT NULL,
  p_details     JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_phone CONSTANT TEXT := public.get_admin_phone();
BEGIN
  IF p_admin_phone != v_admin_phone THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  INSERT INTO public.audit_log (admin_email, action, target_id, details)
  VALUES (p_admin_phone, p_action, p_target_id, p_details);
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_audit_log(TEXT, TEXT, TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.insert_audit_log(TEXT, TEXT, TEXT, JSONB) TO authenticated;


SELECT 'Rate limiting et verify_admin_password appliqués ✅' AS statut;
