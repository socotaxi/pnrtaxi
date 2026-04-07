-- ============================================================
--  submit_payment.sql — Validation du montant côté serveur
--  À exécuter dans : Supabase Dashboard → SQL Editor
--
--  Remplace l'INSERT direct depuis le frontend (payment.js).
--  Le serveur vérifie que le montant correspond bien au tarif
--  configuré dans app_config avant d'insérer la demande.
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_payment_request(
  p_driver_id   TEXT,
  p_type        TEXT,   -- 'journee' ou 'semaine'
  p_montant     INTEGER,
  p_ref         TEXT,
  p_operateur   TEXT    -- 'mtn' ou 'airtel'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tarif_journee INTEGER;
  v_tarif_semaine INTEGER;
  v_tarif_attendu INTEGER;
  v_new_id        UUID;
BEGIN
  -- Validation du type
  IF p_type NOT IN ('journee', 'semaine') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Type invalide');
  END IF;

  -- Validation de l'opérateur
  IF p_operateur NOT IN ('mtn', 'airtel') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Opérateur invalide');
  END IF;

  -- Validation de la référence
  IF p_ref IS NULL OR length(trim(p_ref)) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Référence invalide');
  END IF;

  -- Lire les tarifs depuis app_config
  SELECT
    COALESCE((SELECT valeur::integer FROM public.app_config WHERE cle = 'tarif_journee'), 500),
    COALESCE((SELECT valeur::integer FROM public.app_config WHERE cle = 'tarif_semaine'), 1000)
  INTO v_tarif_journee, v_tarif_semaine;

  v_tarif_attendu := CASE p_type WHEN 'journee' THEN v_tarif_journee ELSE v_tarif_semaine END;

  -- Vérification du montant — refuser si le montant ne correspond pas
  IF p_montant != v_tarif_attendu THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Montant incorrect',
      'attendu', v_tarif_attendu
    );
  END IF;

  -- Empêcher les doublons : pas de demande en attente déjà existante
  IF EXISTS (
    SELECT 1 FROM public.driver_access
    WHERE driver_id = p_driver_id
      AND statut    = 'en_attente'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Une demande est déjà en attente');
  END IF;

  -- Insertion de la demande validée
  INSERT INTO public.driver_access (
    driver_id,
    type,
    montant,
    date_debut,
    date_expiration,
    statut,
    ref_paiement,
    operateur
  ) VALUES (
    p_driver_id,
    p_type,
    v_tarif_attendu,
    NOW(),
    NOW() + INTERVAL '1 year', -- provisoire, confirmée par l'admin
    'en_attente',
    upper(trim(p_ref)),
    p_operateur
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_payment_request(TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_payment_request(TEXT, TEXT, INTEGER, TEXT, TEXT) TO authenticated;

SELECT 'submit_payment_request créée ✅' AS statut;
