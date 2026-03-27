// ============================================================
//  FIREBASE CONFIGURATION — Taxi Pointe-Noire
// ============================================================
//  INSTRUCTIONS :
//  1. Allez sur https://console.firebase.google.com
//  2. Créez un projet (ex: "taxi-pnr")
//  3. Cliquez sur l'icône </> (Web) pour ajouter une app Web
//  4. Copiez les valeurs du bloc firebaseConfig fourni
//  5. Remplacez chaque valeur ci-dessous par les vôtres
//  6. Dans Firebase Console → Build → Firestore Database → Créer
//  7. Démarrez en mode Test (règles ouvertes 30 jours)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyBs4m9Vm577AKImpceDJ4T8tEATUHQu31Y",             // ← Remplacez
  authDomain:        "pnrtaxi.firebaseapp.com", // ← Remplacez
  projectId:         "pnrtaxi",          // ← Remplacez
  storageBucket:     "pnrtaxi.firebasestorage.app", // ← Remplacez
  messagingSenderId: "581876430577",           // ← Remplacez
  appId:             "1:581876430577:web:758ce97fc3fd0ff19cdb50"               // ← Remplacez
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
