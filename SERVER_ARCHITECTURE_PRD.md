# Industrial Solar Telemetry Platform: Final Architecture & PRD

## 1. Overview & Vision
This backend is a **High-Performance Feature-Based Modular Monolith**. It is designed to handle thousands of solar power plants (Sites) streaming telemetry every 1–5 minutes. The system prioritizes **device responsiveness (low latency ACK)**, **multi-tenant data security**, and **automated energy rollups** for blazing-fast dashboard performance.

---

## 2. Infrastructure & Structural Design

### Feature-Based Modular Slicing
Unlike standard MVC projects, this project is organized by **Domain (Feature)**. This allows the system to remain a monolith (for easy deployment) while behaving like microservices (for clear logic isolation).

```text
src/
├── modules/           ← Vertical Business Domains
│   ├── telemetry/     ← Data Ingestion, Energy Processing, Aggregations
│   ├── alert/         ← Monitoring & Anomaly Logic
│   ├── site/          ← Core Metadata & Hierarchy
│   └── user/          ← Auth & Admin Operations
├── shared/            ← Global Cross-Cutting Concerns (DB, Middleware, Utils)
├── infrastructure/    ← External Drivers (Pub/Sub Workers, Cron Schedulers)
└── index.ts           ← Orchestration & Root Export
```

---

## 3. Database Schema & Persistence

### Core Relational Tables
| Table | Description | Logical Purpose |
| :--- | :--- | :--- |
| **`Site`** | The "Plant" master record. | Stores hardware ID, location, and plant capacity. |
| **`TelemetryData`** | The Raw Log archive. | High-volume table containing every historical sensor reading. |
| **`DeviceLiveStatus`** | The **Snapshot Table**. | Flattens the latest reading for instant UI display (CQRS Pattern). |
| **`CurrentDayEnergy`** | The **Live Accumulator**. | Increments energy (kWh) in real-time as power (kW) arrives. |
| **`Daily / Monthly / YearlyEnergy`**| **Aggregated Archive**. | Pre-calculated sums for chart performance. |
| **`SiteUser`** | The **Security Map**. | Junction table mapping many Users to many Sites. |

---

## 4. Domain Deep Dive & Logic

### 📡 Telemetry Module (`src/modules/telemetry`)
*   **`ingestion.service.ts`**: Implements the **Early Acknowledge** pattern. It verifies only if the site exists and immediately returns `202 Accepted` to the hardware after pushing the payload to Pub/Sub.
*   **`processing.service.ts`**: The engine for background logic.
    *   **Duplicates**: Rejects readings if the timestamp already exists for that Site ID.
    *   **Anomaly Filtering**: Rounds data and enforces logical bounds (e.g., negative voltage check).
    *   **Energy Integration**: Uses the **Riemann Sum Logic**. If power is $P$ and time since last reading is $T$, it adds $(P \times T)$ to the `CurrentDayEnergy` table.
*   **`aggregation.service.ts`**: Handles the **Nightly Rollover**. It moves "Today's" energy into a permanent "Daily" record and resets the counter for the actual new IST day.

### 🛡️ Alert Module (`src/modules/alert`)
*   **`alert.service.ts`**: 
    *   **Logic**: Every background telemetry event triggers an alert check. 
    *   **Evaluation**: Compares sensor values against user-defined `AlertRule` thresholds (e.g., Grid Voltage > 250V).
    *   **State Management**: If a violation occurs, the system doesn't just spam alerts; it increments a `count` and updates `lastSeen` if the alert is already active and unresolved.

### 🔒 User & Security Module (`src/modules/user`)
*   **Multi-Tenant Guard**: Every single query for site data (live, historical, or energy) MUST pass through `checkSiteAccess(userId, siteId)`. This logic is non-negotiable and strictly enforced to prevent data leaks between different installations.
*   **Wildcard Logic**: Admins are assigned a `*` flag, which bypasses the `SiteUser` junction check globally.

---

## 5. End-to-End Data Flows

### Flow A: Ingest Hardware Data (Hardware -> UI)
1.  **Hardware** → `POST /ingestTelemetry` → `security.ts` (Validates Hardware Token).
2.  **Controller** → Calls `ingestionModule`.
3.  **Handoff** → Data pushed to **Google Cloud Pub/Sub**. 
4.  **Hardware** receives `success: true` (Total time ~50ms).
5.  **Background Worker** (`infrastructure/pubsub`) → Wakes up and calls `processingModule`.
6.  **DB Update** → Updates `DeviceLiveStatus` and `TelemetryData`.
7.  **Dashboard UI** → Next time user polls `/getLiveReading`, they see the new state instantly.

### Flow B: Nightly Aggregation (Cron)
1.  **Scheduler** → Fires at 00:05 IST.
2.  **Aggregation Module** → Fetches all `CurrentDayEnergy` records.
3.  **Finalization** → Upserts the total into `DailyEnergy`.
4.  **Reset** → Erases `CurrentDayEnergy` and sets the timestamp to the new day in **Asia/Kolkata** timezone.

### Flow C: Chart Rendering (Historical)
1.  User requests telemetry for a specific date.
2.  **Telemetry Controller** → Fetches thousands of rows from `TelemetryData`.
3.  **Downsampling Logic**: The service automatically reduces the data to exactly **96 points** (15-min intervals) if the result set is too large, ensuring charts render smoothly on mobile devices without data bloat.

---

## 6. Project Observability
*   **Uncaught Exceptions**: Global listeners in `index.ts` catch and log node crashes to prevent persistent failures.
*   **IST Enforced**: All time math relies on `src/shared/utils/timeUtils.ts` to ensure energy production resets based on the local solar cycle of the plant, regardless of where the server is hosted (UTC).

---

## 7. Logic Glossary
*   **Integral Calculus**: Applied in the ingestion worker to convert Power (kW) into Energy (kWh).
*   **Join-Table Security**: Used to handle complex relationships where 1 User supervises 50 Sites and 1 Site is monitored by 3 Technicians.
*   **Wildcard Routing**: Allows the system to scale easily for Super-Admins while maintaining strict silos for end customers.
