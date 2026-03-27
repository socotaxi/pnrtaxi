// ============================================================
//  seed.js — Peuplement Firebase avec 6 chauffeurs fictifs
//  Coordonnées GPS réelles des quartiers de Pointe-Noire
//
//  UTILISATION :
//  1. Installez Node.js et firebase-admin :
//       npm install firebase-admin
//  2. Créez une clé de service dans Firebase Console :
//       Paramètres du projet → Comptes de service → Générer une clé privée
//  3. Sauvegardez le JSON sous le nom : serviceAccountKey.json
//  4. Lancez : node seed.js
// ============================================================

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // ← votre clé

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ── Données des chauffeurs ───────────────────────────────────
// Coordonnées GPS des principaux quartiers de Pointe-Noire, Congo
const drivers = [
  {
    id: '242060000001',
    data: {
      nom:        'Jean-Baptiste Mpika',
      photo:      'https://i.pravatar.cc/150?img=1',
      plaque:     'PNR-1234-CG',
      vehicule:   'Toyota Corolla 2019',
      telephone:  '242060000001',
      disponible: true,
      // Quartier : Centre-ville (avenue Charles de Gaulle)
      lat: -4.7750,
      lng: 11.8632,
    }
  },
  {
    id: '242060000002',
    data: {
      nom:        'Arsène Loubaki',
      photo:      'https://i.pravatar.cc/150?img=2',
      plaque:     'PNR-5678-CG',
      vehicule:   'Hyundai Accent 2020',
      telephone:  '242060000002',
      disponible: true,
      // Quartier : Loandjili (proche marché)
      lat: -4.7421,
      lng: 11.8557,
    }
  },
  {
    id: '242060000003',
    data: {
      nom:        'Christelle Moukoko',
      photo:      'https://i.pravatar.cc/150?img=3',
      plaque:     'PNR-9012-CG',
      vehicule:   'Renault Logan 2021',
      telephone:  '242060000003',
      disponible: false,
      // Quartier : Tié-Tié
      lat: -4.8011,
      lng: 11.8704,
    }
  },
  {
    id: '242060000004',
    data: {
      nom:        'Rodrigue Nkodia',
      photo:      'https://i.pravatar.cc/150?img=4',
      plaque:     'PNR-3456-CG',
      vehicule:   'Peugeot 301 2018',
      telephone:  '242060000004',
      disponible: true,
      // Quartier : Mongo-Mpoukou
      lat: -4.7903,
      lng: 11.8820,
    }
  },
  {
    id: '242060000005',
    data: {
      nom:        'Célestine Bouanga',
      photo:      'https://i.pravatar.cc/150?img=5',
      plaque:     'PNR-7890-CG',
      vehicule:   'Toyota Yaris 2022',
      telephone:  '242060000005',
      disponible: true,
      // Quartier : Mvou-Mvou (proche aéroport)
      lat: -4.8162,
      lng: 11.8956,
    }
  },
  {
    id: '242060000006',
    data: {
      nom:        'Patrick Ossoko',
      photo:      'https://i.pravatar.cc/150?img=6',
      plaque:     'PNR-2468-CG',
      vehicule:   'Kia Rio 2020',
      telephone:  '242060000006',
      disponible: false,
      // Quartier : Ngoyo (nord de Pointe-Noire)
      lat: -4.7253,
      lng: 11.8601,
    }
  },
];

// ── Insertion dans Firestore ─────────────────────────────────
async function seed() {
  console.log('🌱 Démarrage du peuplement Firebase...\n');

  const batch = db.batch();

  for (const driver of drivers) {
    const ref = db.collection('drivers').doc(driver.id);
    batch.set(ref, {
      ...driver.data,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`✅ Préparé : ${driver.data.nom} (${driver.id})`);
  }

  await batch.commit();
  console.log(`\n🎉 ${drivers.length} chauffeurs ajoutés avec succès dans Firestore !`);
  console.log('👉 Ouvrez votre app passager sur index.html pour les voir sur la carte.');

  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Erreur lors du seed:', err);
  process.exit(1);
});
