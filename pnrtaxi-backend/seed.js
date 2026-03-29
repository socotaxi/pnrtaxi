// ============================================================
//  seed.js — Alternative Node.js pour peupler Supabase
//  Préférez seed.sql (SQL Editor) qui ne nécessite rien d'installé
//
//  UTILISATION :
//  1. npm install @supabase/supabase-js
//  2. Remplacez SUPABASE_URL et SERVICE_ROLE_KEY ci-dessous
//     (Supabase → Settings → API → service_role — pas l'anon key)
//  3. node seed.js
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL     = 'https://VOTRE_PROJECT.supabase.co'; // ← Remplacez
const SERVICE_ROLE_KEY = 'VOTRE_SERVICE_ROLE_KEY';             // ← Remplacez

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const drivers = [
  {
    id: '242060000001', nom: 'Jean-Baptiste Mpika',
    photo: 'https://i.pravatar.cc/150?img=1', plaque: 'PNR-1234-CG',
    vehicule: 'Toyota Corolla 2019', telephone: '242060000001',
    disponible: true,  lat: -4.7750, lng: 11.8632  // Centre-ville
  },
  {
    id: '242060000002', nom: 'Arsène Loubaki',
    photo: 'https://i.pravatar.cc/150?img=2', plaque: 'PNR-5678-CG',
    vehicule: 'Hyundai Accent 2020', telephone: '242060000002',
    disponible: true,  lat: -4.7421, lng: 11.8557  // Loandjili
  },
  {
    id: '242060000003', nom: 'Christelle Moukoko',
    photo: 'https://i.pravatar.cc/150?img=3', plaque: 'PNR-9012-CG',
    vehicule: 'Renault Logan 2021', telephone: '242060000003',
    disponible: false, lat: -4.8011, lng: 11.8704  // Tié-Tié
  },
  {
    id: '242060000004', nom: 'Rodrigue Nkodia',
    photo: 'https://i.pravatar.cc/150?img=4', plaque: 'PNR-3456-CG',
    vehicule: 'Peugeot 301 2018', telephone: '242060000004',
    disponible: true,  lat: -4.7903, lng: 11.8820  // Mongo-Mpoukou
  },
  {
    id: '242060000005', nom: 'Célestine Bouanga',
    photo: 'https://i.pravatar.cc/150?img=5', plaque: 'PNR-7890-CG',
    vehicule: 'Toyota Yaris 2022', telephone: '242060000005',
    disponible: true,  lat: -4.8162, lng: 11.8956  // Mvou-Mvou
  },
  {
    id: '242060000006', nom: 'Patrick Ossoko',
    photo: 'https://i.pravatar.cc/150?img=6', plaque: 'PNR-2468-CG',
    vehicule: 'Kia Rio 2020', telephone: '242060000006',
    disponible: false, lat: -4.7253, lng: 11.8601  // Ngoyo
  },
];

async function seed() {
  console.log('🌱 Insertion des chauffeurs dans Supabase...\n');

  const { error } = await supabase
    .from('drivers')
    .upsert(drivers, { onConflict: 'id' });

  if (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }

  console.log(`✅ ${drivers.length} chauffeurs insérés avec succès !`);
  console.log('👉 Ouvrez pnrtaxi-frontend/index.html pour les voir sur la carte.');
  process.exit(0);
}

seed();
