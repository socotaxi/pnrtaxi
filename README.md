# 🚖 Taxi Pointe-Noire — PWA

Application mobile de ride-hailing pour Pointe-Noire (Congo-Brazzaville).
Stack : HTML/CSS/JS vanilla · Leaflet.js · **Supabase** · PWA

---

## Prérequis

- Un compte gratuit sur [supabase.com](https://supabase.com) (pas de CB requise)
- Un navigateur moderne (Chrome Android recommandé)

---

## Étape 1 — Créer le projet Supabase

1. Allez sur [supabase.com](https://supabase.com) → **Start your project**
2. Connectez-vous avec GitHub ou Google
3. Cliquez **New Project**
4. Remplissez :
   - **Name** : `taxi-pnr`
   - **Database Password** : choisissez un mot de passe fort (notez-le)
   - **Region** : `West EU (Ireland)` — la plus proche de l'Afrique centrale
5. Cliquez **Create new project** → attendez ~2 minutes

---

## Étape 2 — Récupérer les clés API

1. Dans votre projet Supabase → **Settings** (icône ⚙️) → **API**
2. Copiez :
   - **Project URL** : `https://xxxxxxxxxx.supabase.co`
   - **anon public** key : `eyJhbGci...` (longue chaîne)

Ouvrez [js/supabase-config.js](js/supabase-config.js) et collez ces valeurs :

```js
const SUPABASE_URL      = 'https://xxxxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGci...';
```

---

## Étape 3 — Créer la table et insérer les données

1. Dans Supabase → **SQL Editor** → **New query**
2. Copiez **tout le contenu** du fichier [seed.sql](seed.sql)
3. Collez-le dans l'éditeur → cliquez **Run** (▶️)

Ce script crée automatiquement :
- ✅ La table `drivers` avec les bonnes colonnes
- ✅ Les règles de sécurité (RLS)
- ✅ L'abonnement temps réel
- ✅ Les 6 chauffeurs fictifs de démonstration

Vous devriez voir un tableau avec 6 lignes en résultat.

---

## Étape 4 — Activer le temps réel (si nécessaire)

Si les marqueurs ne se mettent pas à jour en temps réel :

1. Supabase → **Database** → **Replication**
2. Activez le toggle pour la table **drivers**

---

## Étape 5 — Ajouter les icônes PWA

Créez un dossier `icons/` et ajoutez :
- `icons/icon-192.png` (192×192 px)
- `icons/icon-512.png` (512×512 px)

Générez-les sur [realfavicongenerator.net](https://realfavicongenerator.net).

---

## Étape 6 — Tester en local

Les modules ES nécessitent un serveur HTTP (pas `file://`) :

```bash
# Option A — Python
python -m http.server 8080

# Option B — Node.js
npx serve .

# Option C — Extension VSCode "Live Server"
# Clic droit sur index.html → Open with Live Server
```

Ouvrez **http://localhost:8080** → les 6 chauffeurs apparaissent sur la carte.

---

## Étape 7 — Déployer (gratuit)

### Option A — Netlify (le plus simple)

```bash
# Glissez-déposez votre dossier sur app.netlify.com
# Ou via CLI :
npm install -g netlify-cli
netlify deploy --prod
```

### Option B — Vercel

```bash
npm install -g vercel
vercel --prod
```

### Option C — Firebase Hosting (juste l'hébergement, sans Firestore)

```bash
npm install -g firebase-tools
firebase login
firebase init hosting  # Public dir: . | SPA: Non | Overwrite: Non
firebase deploy
```

---

## Structure des fichiers

```
PNR-TAXI/
├── index.html              ← App Passager
├── driver.html             ← App Chauffeur
├── css/style.css           ← Dark mode mobile-first
├── js/
│   ├── supabase-config.js  ← Clés Supabase (à remplir)
│   ├── passenger.js        ← Carte + temps réel Supabase
│   ├── driver.js           ← Login + toggle + GPS
│   └── haversine.js        ← Calcul distance GPS
├── icons/
│   ├── icon-192.png        ← Icône PWA
│   └── icon-512.png
├── manifest.json           ← Manifeste PWA
├── service-worker.js       ← Cache offline
├── seed.sql                ← Script SQL (table + données)
└── README.md
```

---

## Structure de la table Supabase

**Table** : `drivers`
**Clé primaire** : `id` = numéro de téléphone

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | text | Numéro de téléphone (clé primaire) |
| `nom` | text | Nom complet |
| `photo` | text | URL photo |
| `plaque` | text | Immatriculation |
| `vehicule` | text | Marque et modèle |
| `telephone` | text | Numéro WhatsApp |
| `disponible` | boolean | Statut temps réel |
| `lat` | float8 | Latitude GPS |
| `lng` | float8 | Longitude GPS |
| `last_seen` | timestamptz | Dernière mise à jour GPS |

---

## Ajouter un vrai chauffeur

Dans Supabase → **Table Editor** → `drivers` → **Insert row** :

```
id         : 242XXXXXXXXX   (numéro de téléphone)
nom        : Prénom Nom
photo      : https://... (lien image)
plaque     : PNR-XXXX-CG
vehicule   : Marque Modèle
telephone  : 242XXXXXXXXX
disponible : false
lat        : -4.XXXX
lng        : 11.XXXX
```

Le chauffeur peut ensuite se connecter immédiatement sur `driver.html`.

---

## FAQ

**Les chauffeurs n'apparaissent pas sur la carte ?**
→ Vérifiez vos clés dans `supabase-config.js` (URL et anon key).
→ Ouvrez F12 → Console pour voir les erreurs.
→ Vérifiez que `seed.sql` a bien été exécuté (Table Editor → drivers).

**Le temps réel ne fonctionne pas ?**
→ Supabase → Database → Replication → activez `drivers`.
→ Vérifiez que la ligne `ALTER PUBLICATION` dans seed.sql a bien tourné.

**L'app ne se géolocalise pas ?**
→ Le GPS requiert HTTPS. En local, Chrome accepte `localhost`.
→ En production, utilisez Netlify/Vercel/Firebase Hosting (HTTPS automatique).

**Comment sécuriser en production ?**
→ Activez Firebase Auth ou Supabase Auth pour les chauffeurs.
→ Remplacez la politique RLS `UPDATE` par une vérification d'identité.
"# pnrtaxi" 
