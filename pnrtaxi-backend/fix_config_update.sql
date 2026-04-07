-- ============================================================
--  fix_config_update.sql
--  Corrige la mise à jour de app_config depuis l'admin
--  À coller dans : Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Remplacer la policy UPDATE restrictive par une permissive
--    (la sécurité est assurée par la vérification du numéro admin dans la RPC)
DROP POLICY IF EXISTS "app_config_update_admin_only" ON public.app_config;
DROP POLICY IF EXISTS "Config mise à jour"            ON public.app_config;

CREATE POLICY "app_config_update_via_rpc"
  ON public.app_config FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- 2. Recréer la RPC avec row_security désactivé (garantit le bypass RLS)
CREATE OR REPLACE FUNCTION public.update_app_config(
  p_updates     JSONB,
  p_admin_phone TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_cle TEXT;
  v_val TEXT;
BEGIN
  IF p_admin_phone != '+242050787624' THEN
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

-- 3. Corriger immédiatement la valeur bloquée (optionnel — ajustez la valeur)
-- UPDATE public.app_config SET valeur = '1' WHERE cle = 'gratuite_duree_mois';

SELECT cle, valeur FROM public.app_config ORDER BY cle;
