# tuya-power-temp

Application web **Next.js (App Router, TypeScript)** pour agréger, historiser et visualiser la **puissance électrique**, l'**énergie (kWh)**, le **coût (€)** et les métriques de **température / humidité** de vos appareils **Tuya / Smart Life** par pièce et par période.

Conçue pour un hébergement gratuit sur **Vercel (Plan Hobby)**, une base **Neon Serverless Postgres** (`drizzle-orm`) et une collecte planifiée toutes les **30 minutes via `cron-job.org`**.

---

## Architecture

- **Frontend & API :** Next.js 15 App Router + Tailwind CSS + Recharts.
- **Base de données :** Neon Serverless Postgres (`@neondatabase/serverless` + Drizzle ORM).
  - Tables : `rooms`, `devices`, `metric_readings`, `tariff_periods`, `collection_logs`.
  - **Mode Démo automatique :** tant que `DATABASE_URL` n'est pas configuré, l'application démarre sur un jeu de données simulées sur 30 jours (au pas de 30 min) pour tester l'interface immédiatement.
- **Calcul hybride de l'énergie (`src/lib/tariff-engine.ts`) :**
  - Utilise le compteur d'énergie Tuya (`add_ele`) lorsqu'il progresse de manière cohérente, sinon calcule par intégration (`W × Δt`, ~`0.5 h` avec un schedule toutes les 30 min).
  - Configurable par appareil (`Hybride Auto`, `Compteur add_ele`, `Intégration W × 0.5h`).
- **Moteur tarifaire multi-périodes :**
  - Gère les changements annuels de prix du kWh avec dates de validité (`start_date` / `end_date`) et clôture automatique du tarif précédent la veille.
  - Supporte l'option **Base** et l'option **Heures Pleines / Heures Creuses (HP/HC)** avec plages horaires configurables (y compris à cheval sur minuit).

---

## Guide de mise en place pas-à-pas

### 1. Créer un projet dédié sur Tuya IoT Platform (`iot.tuya.com`)

1. Allez sur **[iot.tuya.com](https://iot.tuya.com)** → **Cloud** → **Development** → **Create Cloud Project**.
2. Renseignez :
   - **Industry :** `Smart Home`
   - **Development Method :** `Smart Home`
   - **Data Center :** `Central Europe` (`TUYA_REGION="eu"`) ou `Western Europe` (`TUYA_REGION="weu"`), selon votre compte Smart Life.
3. À l'étape **Authorize API Services**, activez les services gratuits :
   - **IoT Core**
   - **Authorization Token Management**
   - **Smart Home Family Management** *(optionnel)*
4. Dans le projet créé, ouvrez **Devices** → **Link Tuya App Account** → **Add App Account** et scannez le QR code depuis votre application mobile **Smart Life** (ou **Tuya Smart**).
5. Récupérez :
   - **UID** de votre compte lié → `TUYA_USER_UID`
   - **Access ID** et **Access Secret** (onglet **Overview**) → `TUYA_ACCESS_ID` et `TUYA_ACCESS_SECRET`.

### 2. Créer la base Neon Postgres

1. Créez une base gratuite sur **[neon.tech](https://neon.tech)** (ou via **Storage → Neon** dans le dashboard Vercel).
2. Copiez la chaîne de connexion `DATABASE_URL` dans votre fichier `.env.local` (ou dans les variables d'environnement Vercel).
3. Poussez le schéma Postgres :
   ```bash
   npm install
   npm run db:push
   ```

### 3. Variables d'environnement

Copiez `.env.example` vers `.env.local` :

```env
DATABASE_URL="postgresql://user:password@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require"
APP_PASSWORD="votre-mot-de-passe-dashboard"
SCHEDULE_SECRET="secret-long-aleatoire-pour-cron-job-org"
TUYA_ACCESS_ID="votre_access_id_tuya"
TUYA_ACCESS_SECRET="votre_access_secret_tuya"
TUYA_REGION="eu"
TUYA_USER_UID="votre_uid_compte_app_smart_life"
```

### 4. Planifier la collecte toutes les 30 minutes (`cron-job.org`)

Le plan Hobby de Vercel limite les crons natifs à une exécution par jour. L'application expose une route dédiée sécurisée pour être appelée par un scheduler externe toutes les 30 minutes :

1. Créez un compte gratuit sur **[cron-job.org](https://cron-job.org)**.
2. Créez un nouveau job :
   - **URL :** `https://<votre-app>.vercel.app/api/schedule/collect`
   - **Planification :** Toutes les 30 minutes (`*/30 * * * *`)
   - **Méthode HTTP :** `GET` ou `POST`
   - **En-tête HTTP (Advanced → Headers) :**
     - Clé : `Authorization`
     - Valeur : `Bearer <VOTRE_SCHEDULE_SECRET>`

---

## Développement local

```bash
npm install
npm run dev
```

Puis ouvrez [http://localhost:3000](http://localhost:3000).
