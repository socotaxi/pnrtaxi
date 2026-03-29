# 🚖 Taxi Pointe-Noire — Frontend

PWA mobile-first pour passagers et chauffeurs.
Stack : HTML · CSS · JavaScript vanilla · Leaflet.js · Supabase JS SDK

---

## Structure

```
pnrtaxi-frontend/
├── index.html          ← App Passager (carte + recherche chauffeur)
├── driver.html         ← App Chauffeur (login + dashboard GPS)
├── css/
│   └── style.css       ← Dark mode, mobile-first
├── js/
│   ├── supabase-config.js  ← Clés Supabase (à remplir)
│   ├── passenger.js        ← Carte Leaflet + temps réel
│   ├── driver.js           ← Login + toggle + GPS watchPosition
│   └── haversine.js        ← Calcul distance entre deux points GPS
├── icons/
│   ├── icon-192.png    ← Icône PWA
│   └── icon-512.png
├── manifest.json       ← Manifeste PWA (installable Android)
└── service-worker.js   ← Cache offline
```

---

## Configuration Supabase

Ouvrez `js/supabase-config.js` et remplissez vos clés :

```js
const SUPABASE_URL      = 'https://xxxxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGci...';
```

Clés disponibles dans : **Supabase Dashboard → Settings → API**

> La base de données doit être initialisée au préalable.
> Voir le dossier `../pnrtaxi-backend/` pour le script SQL.

---

## Lancer en local

```bash
# Python
python -m http.server 8080

# Node.js
npx serve .

# VSCode : clic droit sur index.html → Open with Live Server
```

Ouvrez **http://localhost:8080**

---

## Déployer (gratuit)

### Netlify (glisser-déposer)
1. Allez sur [app.netlify.com](https://app.netlify.com)
2. Glissez le dossier `pnrtaxi-frontend/` dans la zone de dépôt
3. C'est en ligne instantanément avec HTTPS

### Vercel
```bash
npx vercel --prod
```

### Firebase Hosting (hébergement uniquement)
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
# Public directory : . (ce dossier)
# SPA : Non | Overwrite index.html : Non
firebase deploy
```
