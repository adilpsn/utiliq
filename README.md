# Utiliq

Energy-aware test-bench scheduling for CHP unit manufacturing. Utiliq plans which
unit goes on which test bench and when, with the plant's grid limit, on-site
generation and day-ahead spot prices treated as first-class scheduling
constraints rather than afterthoughts.

Built for a pilot with **2G Energy**. Private repo — see _Confidentiality_ below.

---

## Status — read this first

This is **two things at once**, and the distinction matters:

|                     | What it is                                       | State                                                                            |
| ------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| **The app**         | 9 routes, full UI, scheduling + optimiser engine | Working, but running on **mocked data only**                                     |
| **The ingest path** | Live sensor telemetry via MQTT                   | **Scaffolded, off by default.** No live data has ever flowed from a real broker. |

Nothing here talks to a real plant yet. Every number on screen comes from
`src/lib/utiliq-demo-data.ts`. Treat the UI as a high-fidelity click-dummy whose
engine happens to be real.

## Branches

| Ref                         | Meaning                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `main`                      | Frozen at the demo build. Do not develop here while the pilot demo is live. |
| **`v2/telemetry-scaffold`** | **Active development.** The ingest path. Start here.                        |
| tag `clickdummy-v1`         | The exact commit demoed to 2G. Permanent anchor — never move it.            |

With no `.env`, v2 keeps the telemetry path off and renders the same 9 routes as
`clickdummy-v1`, but the energy numbers **intentionally differ**: v2 fixed the
grid-flow formula (see _Energy model_), so the Command Center grid reads 4.0 MW
import instead of 1.4 MW, and forecast, warnings, auto-schedule scoring and the
"Est. schedule value" KPI shift with it. For the demo build, use `main` or
`clickdummy-v1`.

## Quick start

```bash
git clone <this repo>
cd Utiliq_codebase
npm install
npm run dev
```

Open http://localhost:3000.

### Running with the telemetry pipeline on

```bash
cp .env.example .env              # sets VITE_TELEMETRY=1

# terminal 1 — the collector, replaying a captured topic dump
node collector/index.mjs

# terminal 2
npm run dev:live
```

Then open **/telemetry**. You should see readings arriving, kW scaled to MW,
stale sensors flagged, and the unmapped/unparsable trays filling with the
deliberately-unrecognised lines in `collector/sample-dump.txt`.

```bash
npm test                          # both suites, no test runner needed
npm run test:engine               # 29 assertions — engine + energy balance
npm run test:telemetry            # 51 assertions — telemetry parser
```

## Architecture, in one diagram

```
   broker ──MQTT──►  collector (node)  ──SSE──►  app
                     dumb bridge               parse → map → live store
                                                          │
                     replay file ──┘                      └─► React, batched 250ms
```

Full diagrams (system, modules, planned Pyomo optimiser):
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

Two design decisions worth knowing before you touch anything:

**The collector is a separate process.** The browser never speaks MQTT. That
sidesteps three unknowns at once: a browser cannot open a raw TCP MQTT
connection, Cloudflare Workers cannot hold a persistent subscriber, and a
plant-network-only broker needs a subscriber at the edge. If any of those turn
out to be true, nothing in the app changes.

**All wire-format assumptions live in one file.** `src/lib/telemetry/parse.ts` is
the only place that knows whether payloads are JSON or bare scalars, epoch or
ISO. `mapping.ts` holds topic→sensor routing with per-tag `scale` and `invert`,
as data. So a wrong guess about the broker costs one file or one table row — not
a rewrite. Full detail, including the seven open assumptions, in
[`V2-TELEMETRY.md`](./V2-TELEMETRY.md).

## Energy model & open assumptions

One formula, in `src/lib/energy-balance.ts` → `plantBalanceAt()`, used by every
page, the forecast, warnings, the scheduler and KPIs:

```
gridMW = benches + on-site + battery − base load      (+ = export, − = import)
```

Every resource is signed the same way: + supplies the plant bus, − draws from
it. `resourcePowerMW()` owns the battery sign rule. Open assumptions, to confirm
with the plant — none of these are settled:

- **Base load double-count?** `facilityBaseLoadMW` (1.4 MW) is plant-wide, while
  the chiller (0.9 MW) and compressor (0.6 MW) are also separate resources.
- **Persistence.** PV, loads and battery have no time profile; forecasts hold
  their current value all day (PV stays constant overnight).
- **Battery** ignores state of charge and capacity; direction comes from the
  `status` string.
- **Setup/cooldown power** is a fixed 0.25 / 0.2 MW (`SETUP_POWER_MW` /
  `COOLDOWN_POWER_MW`), not scaled to the unit.
- **A third energy formula remains.** `createRecordFromAssignment` in
  `utiliq-engine.ts` uses 0.45 × base load and hard-coded 62/126/90 €/MWh,
  ignoring the price profile. Left as-is on purpose: changing it changes what
  historical records mean.
- **Standby resources count.** A `standby` resource with non-zero `currentMW`
  still contributes to the balance.

## Layout

```
src/routes/          one file per page (TanStack Router, file-based)
src/lib/
  utiliq-engine.ts   scheduling, warnings, energy forecast — the real logic
  utiliq-engine.test.ts  engine + energy-balance tests (npm run test:engine)
  energy-balance.ts  plantBalanceAt() — the one grid-flow formula
  spot-market.ts     day-ahead price analysis
  utiliq-store.tsx   app state, persisted to localStorage
  utiliq-demo-data.ts  ALL mocked data lives here
  clock.ts           single source of "now"
  telemetry/         the v2 ingest path
collector/           standalone MQTT→SSE bridge, plain Node, no build step
```

## Known issues — please read before filing

1. **State is persisted to `localStorage` by JSON-stringifying the whole store**
   on every change. Fine for a demo, will not survive real data volumes. This is
   why live readings deliberately live in a _separate_ provider
   (`telemetry/live-store.tsx`) and never enter the persisted store.
2. **The warning engine is O(n²)** over scheduled items and re-runs on every
   store change. Fine at 6 items, not at 600.

Fixed in v2:

- `npm install` ERESOLVE — `@lovable.dev/vite-tanstack-config` pinned to 2.3.1;
  no `--legacy-peer-deps` needed.
- Two competing grid-flow formulas — both pages now call `plantBalanceAt()`.
- Two lockfiles — `bun.lock` removed; npm only (`bunfig.toml` kept).
- Two `tsc` errors — `npx tsc --noEmit` is clean.
- No engine tests — `src/lib/utiliq-engine.test.ts`, 29 assertions.

## Where to start

If you are picking this up cold, in order:

1. `npm run dev`, click every route, get a feel for the product.
2. Read `V2-TELEMETRY.md` — it is short and explains the ingest design and the
   seven assumptions still open with 2G.
3. Run the collector + `/telemetry` and watch data flow.
4. Read `src/lib/energy-balance.ts` and _Energy model & open assumptions_
   above — the grid formula every page uses, and what still needs confirming
   with the plant before live values are wired into the demo pages.
5. Read `src/lib/utiliq-engine.ts`. It is the heart of the product and the least
   documented part.

## Conventions

- TypeScript, React 19, TanStack Start/Router, Tailwind + shadcn/ui.
- `npm run format` (Prettier) and `npm run lint` before committing. Both are
  wired; the lint baseline has 3 pre-existing errors (Prettier formatting in
  `src/routes/floor-layout.tsx`).
- Timestamps: **UTC ISO-8601 with an explicit offset**, everywhere, at every
  boundary. The demo path still uses offset-less local strings in places; do not
  copy that pattern into new code.
- Units: the app works in **MW**. Convert at the ingest boundary, never in a
  component.

## Confidentiality

Private repository. Contains a named prospective customer (2G Energy), their
plant layout assumptions, and internal notes on their infrastructure. Do not
fork to a public remote, publish screenshots containing customer names, or share
`V2-TELEMETRY.md` outside the team — it documents our open questions about their
systems.

© 2026 R-Factory eG. All rights reserved. No licence granted.
