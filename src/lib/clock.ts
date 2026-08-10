import { format } from "date-fns";

import { DEMO_NOW } from "./utiliq-demo-data";
import { telemetryEnabled } from "./telemetry/flag";

/**
 * The application's single source of "now".
 *
 * v1 hardcoded DEMO_NOW in 21 places, which meant the app could never show
 * anything but 2 June 2026 10:30. Every one of those sites now calls nowIso().
 *
 * Behaviour:
 *   - telemetry OFF  -> returns DEMO_NOW, so the demo is unchanged
 *   - telemetry ON   -> returns real local wall-clock time
 *   - override set   -> returns the override (for replay of captured dumps,
 *                       where "now" should track the recording, not the wall)
 *
 * Note the format is local-naive ("yyyy-MM-dd'T'HH:mm:ss") to stay compatible
 * with the existing parseDate/toIsoLocal pair in utiliq-engine. Incoming
 * telemetry timestamps are normalised into this shape at the parser boundary —
 * see telemetry/parse.ts. Internally the pipeline carries UTC ISO strings;
 * this is the one place the two conventions meet.
 */

let override: string | null = null;

/** Pin the clock, e.g. while replaying a captured dump. Pass null to release. */
export function setClockOverride(iso: string | null): void {
  override = iso;
}

export function clockOverride(): string | null {
  return override;
}

export function nowIso(): string {
  if (override) return override;
  if (!telemetryEnabled()) return DEMO_NOW;
  return format(new Date(), "yyyy-MM-dd'T'HH:mm:ss");
}

export function nowDate(): Date {
  return new Date(nowIso());
}

/** True when the app is displaying real time rather than the frozen demo clock. */
export function isLiveClock(): boolean {
  return telemetryEnabled() && override === null;
}
