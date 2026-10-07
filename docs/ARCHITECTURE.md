# Utiliq architecture

Three views of the same system, from coarse to fine:

1. **Level 1 — system**: the boxes and how data flows between them.
2. **Level 2 — modules**: the actual files and key functions behind each box.
3. **v2 — Pyomo optimiser (planned)**: where a mathematical optimiser replaces
   the current greedy scheduler.

Legend: solid arrow = always on · dashed arrow = live telemetry path, off unless
`VITE_TELEMETRY=1` · orange = planned, not built yet · red box = has a known issue
(see README *Known issues*).

---

## Level 1 — system

```mermaid
flowchart LR
    subgraph SRC["Data sources"]
        DEMO["Demo data<br/>units, benches, spot prices"]
        BROKER["MQTT broker<br/>plant sensors"]
    end

    COLL["Collector<br/>edge bridge, Node"]
    INGEST["Ingest<br/>parse → map → live store"]
    ENGINE["Engine<br/>schedule · warnings ·<br/>energy forecast · spot market"]
    STATE["App state<br/>persisted to localStorage"]
    UI["UI<br/>React pages"]

    DEMO --> STATE
    STATE <--> ENGINE
    STATE --> UI
    UI -- "user actions" --> STATE

    BROKER -. MQTT .-> COLL
    COLL -. SSE .-> INGEST
    INGEST -. "live readings" .-> UI
```

The app works end to end on demo data. The live path (dashed) is scaffolded
but has not yet been connected to a real broker. Live readings deliberately
stay **out** of the persisted app state.

---

## Level 2 — modules

```mermaid
flowchart LR
    subgraph SRC["Sources"]
        D1["src/lib/utiliq-demo-data.ts<br/>all mocked data"]
        D2["src/lib/mock-data.ts"]
        D3["collector/sample-dump.txt<br/>captured MQTT lines"]
    end

    subgraph COLL["collector/ — Node, no build"]
        C1["sources.mjs<br/>replaySource()"]
        C2["index.mjs<br/>SSE server"]
        C1 --> C2
    end

    subgraph ING["src/lib/telemetry/"]
        T0["flag.ts<br/>telemetryEnabled()"]
        T1["transport.ts<br/>connectCollector()"]
        T2["parse.ts<br/>parsePayload() · toUtcIso()<br/>⚠ all wire-format guesses"]
        T3["mapping.ts<br/>applyMapping() · isStale()<br/>DEFAULT_MAPPINGS"]
        T4["live-store.tsx<br/>TelemetryProvider · useTelemetry()"]
        T0 --> T1 --> T2 --> T3 --> T4
    end

    subgraph ENG["Engine — src/lib/"]
        E1["utiliq-engine.ts<br/>autoSchedule() — greedy<br/>getAssignmentWarnings()<br/>buildEnergyForecast() · gridFlowAt()<br/>calculateKpis() · calculateImpact()<br/>collectAlerts()<br/>⚠ no tests"]
        E2["spot-market.ts<br/>analyzeSpotMarket()"]
        E3["clock.ts<br/>single source of now"]
        E4["utiliq-types.ts"]
    end

    subgraph ST["State"]
        S1["utiliq-store.tsx<br/>UtiliqStoreProvider<br/>→ localStorage"]
    end

    subgraph UI["src/routes/ — one file per page"]
        R1["index.tsx<br/>Command Center"]
        R2["queue.tsx"]
        R3["schedule.tsx"]
        R4["live-energy.tsx<br/>⚠ own grid-flow formula,<br/>disagrees with gridFlowAt()"]
        R5["analysis.tsx"]
        R6["telemetry.tsx"]
        R7["records · history ·<br/>resources · assets ·<br/>floor-layout · settings"]
    end

    D1 --> S1
    D2 --> S1
    S1 <--> E1
    E3 --> E1
    E3 --> E2
    S1 --> UI

    E1 --> R1
    E1 --> R2
    E1 --> R3
    E1 --> R4
    E2 --> R5

    D3 -.-> C1
    C2 -. SSE .-> T1
    T4 -.-> R6

    classDef bug fill:#fde8e8,stroke:#c0392b,color:#7b1d1d
    class E1,R4 bug
```

Where to look first: `utiliq-engine.ts` is the heart of the product.
`parse.ts` and `mapping.ts` are the only files that need to change once the
real broker format is known.

---

## v2 — Pyomo optimiser (planned)

The greedy `autoSchedule()` handles units one at a time, in priority and
deadline order, and keeps the best-scoring bench × hour slot for each. It never
revisits earlier choices. v2 replaces it with a **MILP solved by Pyomo**. The
MILP weighs every unit, bench and slot together under the grid limit and spot
prices. Because Pyomo is Python, it runs as a separate service and the
TypeScript app calls it.

```mermaid
flowchart LR
    subgraph SRC["Data sources"]
        DEMO["Demo / ERP data<br/>units, benches, deadlines"]
        SPOT["Day-ahead spot prices"]
        BROKER["MQTT broker"]
    end

    COLL["Collector"]
    INGEST["Ingest<br/>parse → map → live store"]

    subgraph ENG["Engine — TypeScript"]
        PREP["build model input<br/>items · benches · grid limit ·<br/>prices · effectiveWeights()"]
        CALL["solve server function<br/>createServerFn"]
        GREEDY["autoSchedule()<br/>greedy fallback"]
        WARN["getAssignmentWarnings()<br/>forecast · KPIs"]
    end

    subgraph OPT["Optimiser service — Python, new"]
        API["FastAPI<br/>POST /solve"]
        MODEL["Pyomo model<br/>x[unit, bench, slot] ∈ {0,1}"]
        SOLVER["HiGHS / CBC solver"]
        API --> MODEL --> SOLVER
    end

    STATE["App state"]
    UI["UI"]

    DEMO --> PREP
    SPOT --> PREP
    PREP --> CALL
    CALL -- "JSON request" --> API
    SOLVER -- "assignments + objective" --> CALL
    CALL -- "timeout / infeasible" --> GREEDY
    CALL --> WARN
    GREEDY --> WARN
    WARN --> STATE --> UI

    BROKER -. MQTT .-> COLL -. SSE .-> INGEST -. "actual load → re-solve" .-> PREP

    classDef planned fill:#fff1e0,stroke:#e67e22,color:#7a3d00
    class API,MODEL,SOLVER,CALL,PREP planned
```

**Model sketch**

| | |
|---|---|
| Decision | `x[u,b,t] = 1` if unit *u* starts on bench *b* in slot *t* |
| Each unit once | Σ<sub>b,t</sub> x[u,b,t] = 1 (or ≤ 1 with a penalty for leaving a unit unscheduled) |
| Compatibility | x = 0 wherever `isBenchCompatible(u, b)` is false |
| No overlap | at most one running test per bench per slot |
| Grid limit | Σ test power(t) − on-site generation(t) ≤ grid import limit, every slot |
| Deadlines | lateness ≥ end − deadline, penalised |
| Objective | minimise spot-price energy cost + lateness + curtailment, weighted by `effectiveWeights()` |

**Rollout:** keep `autoSchedule()` as the fallback and add the optimiser behind
a flag, the same way `VITE_TELEMETRY` gates live ingest. Compare both schedules
on the same input before switching the default.
