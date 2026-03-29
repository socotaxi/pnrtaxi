# 🗄️ Taxi Pointe-Noire — Backend

Scripts de base de données pour Supabase (PostgreSQL).

---

## Structure

```
pnrtaxi-backend/
├── seed.sql    ← Script SQL complet (table + sécurité + données)
└── seed.js     ← Alternative Node.js (optionnel)
```

---

## Initialisation de la base de données

### Méthode recommandée — SQL Editor (aucun prérequis)

1. Allez sur [supabase.com](https://supabase.com) → votre projet
2. **SQL Editor** → **New query**
3. Copiez tout le contenu de `seed.sql`
4. Collez et cliquez **Run ▶️**

Ce script exécute dans l'ordre :
- Création de la table `drivers`
- Activation de la sécurité RLS
- Politiques de lecture/écriture
- Activation du temps réel
- Insertion des 6 chauffeurs de démonstration

---

## Structure de la table `drivers`

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | text | Numéro de téléphone (clé primaire) |
| `nom` | text | Nom complet |
| `photo` | text | URL photo |
| `plaque` | text | Immatriculation |
| `vehicule` | text | Marque et modèle |
| `telephone` | text | Numéro WhatsApp |
| `disponible` | boolean | Statut en temps réel |
| `lat` | float8 | Latitude GPS |
| `lng` | float8 | Longitude GPS |
| `last_seen` | timestamptz | Dernière mise à jour GPS |
| `created_at` | timestamptz | Date d'inscription |

---

## Ajouter un chauffeur manuellement

Via **Supabase → Table Editor → drivers → Insert row** :

```
id         : 242XXXXXXXXX
nom        : Prénom Nom
photo      : https://... (URL image)
plaque     : PNR-XXXX-CG
vehicule   : Marque Modèle Année
telephone  : 242XXXXXXXXX
disponible : false
lat        : -4.XXXX
lng        : 11.XXXX
```

---

## Méthode alternative — seed.js (Node.js)

```bash
npm install @supabase/supabase-js

# Éditez seed.js et remplissez SUPABASE_URL + SERVICE_ROLE_KEY
# (Settings → API → service_role — PAS l'anon key)

node seed.js
```

---

## Activer le temps réel (si nécessaire)

Si les marqueurs ne bougent pas en temps réel sur la carte :

1. Supabase → **Database** → **Replication**
2. Activez le toggle pour la table **drivers**

Ou relancez cette requête SQL :
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
```
