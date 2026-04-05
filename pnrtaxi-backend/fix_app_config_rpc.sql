-- ============================================================
--  fix_app_config_rpc.sql
--  Fonction RPC SECURITY DEFINER pour mettre à jour app_config
--  sans nécessiter une session Supabase Auth.
--  À coller dans : Supabase Dashboard → SQL Editor → New query
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_app_config(
  p_updates  JSONB,
  p_admin_phone TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cle   TEXT;
  v_val   TEXT;
BEGIN
  -- Vérifie que le numéro correspond bien au compte admin
  IF p_admin_phone != '+242050787624' THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  -- Met à jour chaque clé présente dans le JSON
  FOR v_cle, v_val IN
    SELECT key, value FROM jsonb_each_text(p_updates)
  LOOP
    UPDATE public.app_config
    SET valeur = v_val
    WHERE cle = v_cle;

    -- Si la ligne n'existait pas, l'insérer
    IF NOT FOUND THEN
      INSERT INTO public.app_config (cle, valeur) VALUES (v_cle, v_val);
    END IF;
  END LOOP;
END;
$$;

-- Autoriser l'appel depuis le rôle anon (clé publique du frontend)
GRANT EXECUTE ON FUNCTION public.update_app_config(JSONB, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_app_config(JSONB, TEXT) TO authenticated;


-- ============================================================
--  Fonction RPC pour insérer dans audit_log
--  (contourne RLS qui exige is_admin())
-- ============================================================
CREATE OR REPLACE FUNCTION public.insert_audit_log(
  p_admin_phone TEXT,
  p_action      TEXT,
  p_target_id   TEXT    DEFAULT NULL,
  p_details     JSONB   DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Vérifie que le numéro correspond bien au compte admin
  IF p_admin_phone != '+242050787624' THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  INSERT INTO public.audit_log (admin_email, action, target_id, details)
  VALUES (p_admin_phone, p_action, p_target_id, p_details);
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_audit_log(TEXT, TEXT, TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.insert_audit_log(TEXT, TEXT, TEXT, JSONB) TO authenticated;
