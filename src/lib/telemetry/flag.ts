/**
 * Feature flag for the v2 telemetry pipeline.
 *
 * OFF by default. With the flag off the application behaves exactly as
 * `clickdummy-v1` did: the clock stays frozen at DEMO_NOW, no transport is
 * opened, and no telemetry UI is mounted. This is deliberate — the demo build
 * must stay byte-identical while the ingest path is under construction.
 *
 * Enable with `VITE_TELEMETRY=1` in `.env` (or the shell) and restart Vite.
 */
export function telemetryEnabled(): boolean {
  return import.meta.env.VITE_TELEMETRY === "1" || import.meta.env.VITE_TELEMETRY === "true";
}

/** URL of the collector's SSE endpoint. The browser never speaks MQTT. */
export function collectorUrl(): string {
  return import.meta.env.VITE_COLLECTOR_URL ?? "http://localhost:4000/stream";
}
