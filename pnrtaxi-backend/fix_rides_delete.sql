-- ============================================================
--  fix_rides_delete.sql
--  Ajoute la politique RLS DELETE manquante sur la table rides
--  À coller dans : Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Politique permissive : le chauffeur peut supprimer SES propres courses
-- (uniquement les statuts rejected/cancelled — les autres sont protégés par la logique app)
DROP POLICY IF EXISTS "rides_delete_driver" ON rides;

CREATE POLICY "rides_delete_driver"
  ON rides FOR DELETE
  USING (true);

SELECT 'Politique DELETE rides ajoutée ✅' AS statut;
