import type { ParsedSample } from "./parse";
import type { Reading, Sensor, TagMapping } from "./types";

/**
 * Topic -> sensor resolution, plus the two corrections that most often go wrong
 * in energy integrations (unit scale, sign convention).
 *
 * The mapping table is DATA, not code. When the on-site answer contradicts an
 * assumption below, the fix is editing a row — not a deploy.
 */

/**
 * MQTT wildcard match. `+` matches exactly one segment, `#` matches the rest.
 * Returns the topic segments on a hit so callers can extract an id.
 */
export function matchTopic(topic: string, pattern: string): string[] | null {
  const t = topic.split("/");
  const p = pattern.split("/");

  for (let i = 0; i < p.length; i += 1) {
    if (p[i] === "#") return t;
    if (i >= t.length) return null;
    if (p[i] === "+") continue;
    if (p[i].toLowerCase() !== t[i].toLowerCase()) return null;
  }
  return p.length === t.length ? t : null;
}

/**
 * Resolve an address to a mapping. `subKey` (set when one payload carried
 * several measurements) is appended to the topic first, so a nested payload
 * behaves identically to a per-measurement topic. First match wins — order the
 * table most-specific first.
 */
export function resolveMapping(
  topic: string,
  subKey: string | undefined,
  table: TagMapping[],
): { mapping: TagMapping; segments: string[] } | null {
  const address = subKey ? `${topic}/${subKey}` : topic;
  for (const mapping of table) {
    const segments = matchTopic(address, mapping.pattern);
    if (segments) return { mapping, segments };
  }
  return null;
}

/**
 * Apply a mapping to a parsed sample, producing a canonical Reading.
 *
 * Order matters and is not arbitrary: scale first (unit conversion), then
 * invert (sign convention). Doing it the other way round gives the same answer
 * for these operations, but stating the order stops it drifting later.
 */
export function applyMapping(
  sample: ParsedSample,
  mapping: TagMapping,
  segments: string[],
  receivedAt: string,
): Reading {
  const scaled = sample.value * (mapping.scale ?? 1);
  const value = mapping.invert ? -scaled : scaled;

  const sensorId =
    mapping.resourceIdFromSegment !== undefined && segments[mapping.resourceIdFromSegment]
      ? mapping.sensorId.replace("*", segments[mapping.resourceIdFromSegment].toUpperCase())
      : mapping.sensorId;

  return {
    sensorId,
    value,
    rawValue: sample.value,
    at: sample.at ?? receivedAt,
    quality: sample.qualityHint === "error" ? "error" : "ok",
  };
}

/** True when a reading has aged past its sensor's tolerance. */
export function isStale(reading: Reading, sensor: Sensor | undefined, now: Date): boolean {
  const tolerance = (sensor?.staleAfterSeconds ?? 30) * 1000;
  const age = now.getTime() - new Date(reading.at).getTime();
  return age > tolerance;
}

// ---------------------------------------------------------------------------
//  DEFAULT ASSUMPTIONS — every one of these is a guess to confirm at 2G.
//  They exist so the pipeline runs end-to-end tonight, not because they are
//  believed. Each row is annotated with what to verify.
// ---------------------------------------------------------------------------

/**
 * ASSUMED CONVENTION (proposed to 2G):
 *   utiliq/<site>/<zone>/<resourceId>/<measurement>
 *   e.g. utiliq/2g/hallB/TB-01/power
 *
 * The wildcard row below matches ANY four-or-more-segment topic ending in a
 * known measurement name and lifts the resource id out of segment 3, so a
 * plausible-but-different tree still lands somewhere useful rather than in the
 * unmapped tray. Tighten it once the real tree is known.
 */
export const DEFAULT_MAPPINGS: TagMapping[] = [
  {
    id: "power-generic",
    // segments:      0     1    2     3            4
    pattern: "+/+/+/+/power",
    sensorId: "*.power",
    resourceIdFromSegment: 3,
    // ASSUMPTION: gear reports kW; Utiliq works in MW. If they report MW, set 1.
    scale: 0.001,
    // ASSUMPTION: they report generation as POSITIVE; Utiliq treats consumption
    // as negative and generation as positive, so no flip. VERIFY THIS — it is
    // the single most common silent error in energy integrations.
    invert: false,
    note: "ASSUMED kW -> MW, generation-positive. Confirm unit and sign with 2G.",
  },
  {
    id: "power-mw-explicit",
    pattern: "+/+/+/+/power_mw",
    sensorId: "*.power",
    resourceIdFromSegment: 3,
    scale: 1,
    invert: false,
    note: "Topic states MW explicitly, so no scaling.",
  },
  {
    id: "power-kw-explicit",
    pattern: "+/+/+/+/power_kw",
    sensorId: "*.power",
    resourceIdFromSegment: 3,
    scale: 0.001,
    invert: false,
    note: "Topic states kW explicitly.",
  },
  {
    id: "temperature-generic",
    pattern: "+/+/+/+/temperature",
    sensorId: "*.temperature",
    resourceIdFromSegment: 3,
    scale: 1,
    invert: false,
    note: "ASSUMED degrees Celsius.",
  },
  {
    id: "grid-import-export",
    pattern: "+/+/+/GRID-01/#",
    sensorId: "GRID-01.power",
    scale: 0.001,
    invert: false,
    note: "ASSUMED import-positive at the grid meter. VERIFY — often inverted.",
  },
];

/**
 * Seed sensor catalogue derived from the resource ids already in the app
 * (TB-01..TB-05, GRID-01, BAT-01, PV-01/02, LB-01, COOL-01, AIR-01, FUEL-01).
 * Zone/x/y are intentionally absent: they get filled in from the site photos,
 * and until then every sensor shows up in the unplaced tray rather than
 * vanishing — the failure mode v1's floor plan had.
 */
const POWERED_RESOURCES = [
  "TB-01",
  "TB-02",
  "TB-03",
  "TB-04",
  "TB-05",
  "GRID-01",
  "BAT-01",
  "PV-01",
  "PV-02",
  "LB-01",
  "COOL-01",
  "AIR-01",
  "FUEL-01",
];

export const DEFAULT_SENSORS: Sensor[] = POWERED_RESOURCES.map((resourceId) => ({
  id: `${resourceId}.power`,
  label: `${resourceId} power`,
  resourceId,
  measurement: "power",
  unit: "MW",
  staleAfterSeconds: 30,
  visibleInPhoto: true,
}));
