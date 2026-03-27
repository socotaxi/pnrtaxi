// ============================================================
//  SUPABASE CONFIGURATION — Taxi Pointe-Noire
// ============================================================
//  INSTRUCTIONS :
//  1. Allez sur https://supabase.com → New Project
//  2. Nommez-le "taxi-pnr", choisissez un mot de passe fort
//  3. Région : West EU (Ireland) — la plus proche du Congo
//  4. Une fois créé → Settings → API
//  5. Copiez "Project URL" → remplacez VOTRE_PROJECT_URL ci-dessous
//  6. Copiez "anon public" key → remplacez VOTRE_ANON_KEY ci-dessous
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL      = 'VOTRE_PROJECT_URL';   // ex: https://abcdef.supabase.co
const SUPABASE_ANON_KEY = 'VOTRE_ANON_KEY';      // clé "anon public"

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
