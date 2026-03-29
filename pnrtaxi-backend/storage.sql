-- ============================================================
--  storage.sql — Bucket avatars + policies RLS
--  À coller dans : Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Créer le bucket avatars (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Policies — lecture publique
DROP POLICY IF EXISTS "Avatars lecture publique" ON storage.objects;
CREATE POLICY "Avatars lecture publique"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- 3. Policies — upload (INSERT) libre
DROP POLICY IF EXISTS "Avatars upload libre" ON storage.objects;
CREATE POLICY "Avatars upload libre"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars');

-- 4. Policies — mise à jour (UPDATE) libre
DROP POLICY IF EXISTS "Avatars update libre" ON storage.objects;
CREATE POLICY "Avatars update libre"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars')
  WITH CHECK (bucket_id = 'avatars');

SELECT 'Bucket avatars configuré ✅' AS statut;
