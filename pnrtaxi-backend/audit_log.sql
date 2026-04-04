-- ============================================================
--  audit_log.sql — Journal des actions admin PNR TAXI
--  À coller dans : Supabase Dashboard → SQL Editor → New query
--  Prérequis : security.sql (fonction is_admin()) déjà exécuté
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  admin_email TEXT        NOT NULL,
  action      TEXT        NOT NULL,   -- ex: 'validate_payment', 'reject_payment'
  target_id   TEXT,                   -- driver_id ou access_id concerné
  details     JSONB                   -- contexte libre (type, montant, etc.)
);

-- Index pour les requêtes de consultation (tri par date)
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON public.audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON public.audit_log(action);

-- Activer RLS
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Lecture : admin uniquement
DROP POLICY IF EXISTS "audit_log_select_admin" ON public.audit_log;
CREATE POLICY "audit_log_select_admin"
  ON public.audit_log FOR SELECT
  USING (public.is_admin());

-- Insertion : admin uniquement (les actions sont loguées depuis le dashboard)
DROP POLICY IF EXISTS "audit_log_insert_admin" ON public.audit_log;
CREATE POLICY "audit_log_insert_admin"
  ON public.audit_log FOR INSERT
  WITH CHECK (public.is_admin());

-- Pas de UPDATE ni DELETE (journal immuable)

SELECT 'Table audit_log créée ✅' AS statut;
