# Utiliq

Energy-aware test-bench scheduling for CHP unit manufacturing. Utiliq plans which
unit goes on which test bench and when, with the plant's grid limit, on-site
generation and day-ahead spot prices treated as first-class scheduling
constraints rather than afterthoughts.

Built for a pilot with **2G Energy**. Private repo — see *Confidentiality* below.

---

## Status — read this first

This is **two things at once**, and the distinction matters:

| | What it is | State |
|---|---|---|
| **The app** | 9 routes, full UI, scheduling + optimiser engine | Working, but running on **mocked data only** |
| **The ingest path** | Live sensor telemetry via MQTT | **Scaffolded, off by default.** No live data has ever flowed from a real broker. |

Nothing here talks to a real plant yet. Every number on screen comes from
`src/lib/utiliq-demo-data.ts`. Treat the UI as a high-fidelity click-dummy whose
engine happens to be real.

## Branches

| Ref | Meaning |
|---|---|
| `main` | Frozen at the demo build. Do not develop here while the pilot demo is live. |
| **`v2/telemetry-scaffold`** | **Active development.** The ingest path. Start here. |
| tag `clickdummy-v1` | The exact commit demoed to 2G. Permanent anchor — never move it. |

The v2 branch is a strict superset of `main`: with no `.env`, all 9 routes render
character-for-character identically to `clickdummy-v1`. That was verified by
diffing rendered HTML, not by assumption, so you can develop on v2 without
endangering a demo.

## Quick start

```bash
git clone <this repo>
cd Utiliq_codebase
npm install --legacy-peer-deps    # the flag is required — see Known issues #1
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
npm run test:telemetry            # 51 assertions, no test runner needed
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

## Layout

```
src/routes/          one file per page (TanStack Router, file-based)
src/lib/
  utiliq-engine.ts   scheduling, warnings, energy forecast — the real logic
  spot-market.ts     day-ahead price analysis
  utiliq-store.tsx   app state, persisted to localStorage
  utiliq-demo-data.ts  ALL mocked data lives here
  clock.ts           single source of "now"
  telemetry/         the v2 ingest path
collector/           standalone MQTT→SSE bridge, plain Node, no build step
```

## Known issues — please read before filing

1. **`npm install` fails with ERESOLVE.** The pinned `nitro` devDependency
   conflicts. Use `--legacy-peer-deps`. A real fix is bumping `nitro` to
   `>=3.0.260603-beta` and committing the lockfile — worth doing.
2. **Two competing grid-flow formulas.** `utiliq-engine.ts` and
   `live-energy.tsx` compute the plant's grid flow differently, so the Command
   Center and the Live Energy page can disagree. This is the highest-priority
   correctness bug in the repo. Fix by deleting one and calling the other.
3. **State is persisted to `localStorage` by JSON-stringifying the whole store**
   on every change. Fine for a demo, will not survive real data volumes. This is
   why live readings deliberately live in a *separate* provider
   (`telemetry/live-store.tsx`) and never enter the persisted store.
4. **The warning engine is O(n²)** over scheduled items and re-runs on every
   store change. Fine at 6 items, not at 600.
5. **Two lockfiles** — `package-lock.json` and `bun.lock`. Pick one and delete
   the other.
6. **Two pre-existing `tsc` errors** (`utiliq-store.tsx:186`,
   `live-energy.tsx:395`). Untouched deliberately; both are demo-path code. The
   telemetry code is type-clean.
7. **No tests outside the telemetry parser.** The scheduling engine — the most
   valuable logic here — has none.

## Where to start

If you are picking this up cold, in order:

1. `npm run dev`, click every route, get a feel for the product.
2. Read `V2-TELEMETRY.md` — it is short and explains the ingest design and the
   seven assumptions still open with 2G.
3. Run the collector + `/telemetry` and watch data flow.
4. Fix known issue #2 (the grid-flow contradiction). Small, self-contained, and
   it unblocks wiring live values into the demo pages.
5. Read `src/lib/utiliq-engine.ts`. It is the heart of the product and the least
   documented part.

## Conventions

- TypeScript, React 19, TanStack Start/Router, Tailwind + shadcn/ui.
- `npm run format` (Prettier) and `npm run lint` before committing. Both are
  wired; the lint baseline has 8 pre-existing errors, all in files listed above.
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
