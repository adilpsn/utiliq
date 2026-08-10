# v2 telemetry scaffold

Branch: `v2/telemetry-scaffold` · built 11 Aug 2026, before the 2G site visit.
`clickdummy-v1` is untouched and still the demo build.

---

## What this is

The **assumption-free** part of live ingest — everything that has to exist no
matter what 2G's broker turns out to be, plus one deliberately isolated file
holding every guess about the wire format.

It is off by default. With no `.env`, the app is byte-identical to
`clickdummy-v1`: all 9 routes were rendered before and after and diffed —
identical apart from TanStack's per-request hydration timestamp.

## Try it

```bash
npm install --legacy-peer-deps     # see "known issues"

# terminal 1 — the collector, replaying a captured dump
node collector/index.mjs

# terminal 2 — the app with ingest on
cp .env.example .env
npm run dev:live                   # = VITE_TELEMETRY=1 vite dev
```

Then open **/telemetry**. You should see readings arriving, kW scaled to MW,
stale sensors flagged, and the unmapped/unparsable trays filling with the
deliberately-unrecognised lines from the sample dump.

```bash
npm run test:telemetry             # 51 assertions, no runner needed
```

## Architecture

```
   broker ──MQTT──►  collector (node)  ──SSE──►  app
                     dumb bridge               parse → map → live store
                                                          │
                     replay file ──┘                      └─► React, batched 250ms
```

**The collector is a separate process on purpose.** It sidesteps the three
biggest unknowns before the site visit, all at once:

1. A browser cannot open a raw TCP MQTT connection. If 2G's broker has no
   WebSocket listener, an in-app client is impossible — with a collector it
   never matters.
2. Cloudflare Workers (the Lovable config's default target) are request-scoped
   and cannot hold a persistent subscriber.
3. If the broker is reachable only inside the plant network, the collector runs
   at the edge and pushes outward. No change to the app.

The collector does **not** parse payloads. It forwards `{topic, payload,
receivedAt}` and nothing else, so there is exactly one parser in the system.

## Files

| Path                               | Role                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `src/lib/telemetry/parse.ts`       | **The quarantine file.** Every wire-format assumption lives here and nowhere else. |
| `src/lib/telemetry/mapping.ts`     | topic → sensor, plus per-tag `scale` and `invert`. Data, not code.                 |
| `src/lib/telemetry/types.ts`       | `Reading`, `Sensor`, `Zone`, `TagMapping`. Broker-agnostic.                        |
| `src/lib/telemetry/live-store.tsx` | Live values, held **outside** the persisted store. Coalesced flush.                |
| `src/lib/telemetry/transport.ts`   | SSE client with backoff.                                                           |
| `src/lib/telemetry/flag.ts`        | The feature flag.                                                                  |
| `src/lib/clock.ts`                 | Single source of "now", replacing 15 hardcoded `DEMO_NOW` reads.                   |
| `src/routes/telemetry.tsx`         | Ingest diagnostics + the unmapped tray.                                            |
| `collector/index.mjs`              | The bridge: MQTT or replay → SSE.                                                  |
| `collector/sources.mjs`            | The two sources.                                                                   |
| `collector/sample-dump.txt`        | Invented traffic, in `mosquitto_sub -v` format.                                    |

## The five things that made this worth building tonight

**1. The clock is no longer frozen.** `DEMO_NOW` was read in 15 places, so the
app could never show anything but 2 June 2026 10:30. All 15 now call
`nowIso()`, which returns `DEMO_NOW` when telemetry is off and real time when
it is on. With the flag on, the Command Center header reads the actual date.

**2. Live values never touch localStorage.** The main store JSON-stringifies its
entire state on every change. Routing a feed through it would write megabytes a
minute, blow the ~5 MB quota, and re-run the O(n²) warning engine per message.
Live readings sit in a separate provider, in memory only.

**3. Ingest is coalesced, not per-message.** Frames land in a ref-held buffer and
flush once per 250 ms in a single `setState`. A thousand messages a second costs
React four renders.

**4. Nothing is silently dropped.** Unmatched topics go to an unmapped tray and
unparseable payloads to a second one, both visible on `/telemetry`. The v1 floor
plan filtered out unplaced resources while still counting them as "placed" —
that pattern is what makes an integration look finished when it isn't.

**5. Timestamps are UTC, everywhere.** Every reading carries `at` as a UTC ISO
string with an explicit offset. v1's `toIsoLocal` emitted offset-less local
strings, which silently shift incoming UTC payloads by +2 in Münster.
Out-of-order frames are resolved by timestamp, not arrival order, so a late
duplicate on QoS 0 cannot overwrite a fresher value.

## Assumptions to confirm at 2G

All of these are guesses, listed in the order they will bite. Each is a
**config change**, not a code change — that is the design. They are also shown
in the app at the bottom of `/telemetry`.

| #   | Assumption                                               | Where                               | If wrong                |
| --- | -------------------------------------------------------- | ----------------------------------- | ----------------------- |
| 1   | Gear reports **kW**; Utiliq works in MW                  | `mapping.ts` → `scale: 0.001`       | change one number       |
| 2   | **Generation is positive** on the wire                   | `mapping.ts` → `invert: false`      | flip one boolean        |
| 3   | Topic tree is `<site>/<zone>/<resourceId>/<measurement>` | `mapping.ts` → `pattern`            | rewrite the patterns    |
| 4   | Resource id sits in **segment 3**                        | `resourceIdFromSegment: 3`          | change one index        |
| 5   | Offset-less timestamps mean **UTC**                      | `parse.ts` → `UTC_WHEN_NAIVE`       | flip one constant       |
| 6   | Payload is a scalar or `{value}`-ish JSON                | `parse.ts`                          | rewrite `parse.ts` only |
| 7   | Grid meter is **import-positive**                        | `mapping.ts` → `grid-import-export` | flip one boolean        |

If assumptions 1–5 and 7 are all wrong, that is seven edits to a table. Only #6
touches code, and only one file.

## What is deliberately NOT built

- **No MQTT client.** `mqtt` is a lazy optional import in the collector, not an
  app dependency. Install it where the collector runs: `npm i mqtt`.
- **No live values wired into the demo pages yet.** `useTelemetry()` exposes
  `readingForResource(resourceId)`, but nothing consumes it. Wiring it in means
  first reconciling the two competing grid-flow formulas (see the audit, §3a) —
  do that with real numbers in hand, not against invented ones.
- **No map.** The `Zone` type and the `zoneId`/`x`/`y` fields on `Sensor` are
  defined and intentionally unset, so every sensor lands in the unplaced tray
  until the photos exist. **Store positions as normalised 0–1 per zone image,
  never pixels**, and never crop or rotate a photo after recording positions
  against it.
- **No persistence of readings.** There is no historian here. If 2G already has
  one, that is likely the better integration point than MQTT — ask.

## Known issues carried over from v1

- `npm install` fails with ERESOLVE on the pinned `nitro` devDependency. Use
  `--legacy-peer-deps`, or bump `nitro` to `>=3.0.260603-beta` and commit it.
- Two pre-existing `tsc` errors remain (`utiliq-store.tsx:186`,
  `live-energy.tsx:395`). Untouched on purpose — they are demo-path code and
  tonight was not the night. The new telemetry code is type-clean.
- Both `package-lock.json` and `bun.lock` are present. Pick one.

## Verification run

- `npm run test:telemetry` — 51 assertions pass
- `vite build` — exits 0, both with the flag on and off
- All 9 demo routes rendered identically with the flag off (diffed against
  `clickdummy-v1`)
- End-to-end in headless Chromium with the collector replaying: connection
  `Connected`, 15 sensors mapped, kW→MW scaling correct, subKey extraction from
  nested payloads working, staleness detected, 5 unmapped + 2 unparsable topics
  surfaced, no app errors
