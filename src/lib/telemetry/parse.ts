/**
 * ============================================================================
 *  THE QUARANTINE FILE
 * ============================================================================
 *
 * Every assumption about what 2G's broker actually puts on the wire lives in
 * this one file. Nothing else in the application knows whether payloads are
 * JSON or bare scalars, whether timestamps are epoch or ISO, or whether the
 * broker speaks Sparkplug.
 *
 * If tomorrow's topic dump contradicts all of it: rewrite THIS FILE. Nothing
 * downstream changes. That is the whole point of the design — a wrong guess
 * costs one file, not a rebuild.
 *
 * Deliberately dependency-free and pure, so it can be unit-tested without a
 * browser, a broker, or a React tree.
 *
 * Shapes currently handled (all seen in the wild on industrial brokers):
 *   3.14                          bare scalar
 *   "3.14 kW"                     scalar with a unit suffix
 *   true / false                  boolean -> 1 / 0
 *   {"value": 3.14}               the common case
 *   {"v": 3.14, "ts": 1786...}    terse gateway style
 *   {"value": 3.14, "timestamp": "2026-08-11T08:30:00Z"}
 *   {"d": {"power": 3.14, "temp": 61}}   nested, multi-measurement
 *   {"metrics":[{"name":"power","value":3.14,"timestamp":...}]}  Sparkplug-ish
 */

/** One measurement extracted from a payload, before mapping is applied. */
export type ParsedSample = {
  value: number;
  /** UTC ISO-8601 with offset, when the payload carried a usable timestamp. */
  at?: string;
  /**
   * Set when one payload carried several measurements. The mapping matcher
   * appends it to the topic, so `{"d":{"power":1,"temp":2}}` on `plant/TB-01`
   * behaves exactly like `plant/TB-01/power` and `plant/TB-01/temp`.
   */
  subKey?: string;
  qualityHint?: "ok" | "error";
};

const VALUE_KEYS = ["value", "v", "val", "reading", "measurement", "result", "pv"];
const TIME_KEYS = ["timestamp", "ts", "time", "t", "at", "datetime", "eventTime"];
const QUALITY_KEYS = ["quality", "q", "status", "state"];
const CONTAINER_KEYS = ["d", "data", "payload", "body", "values", "measurements"];

/** Keys that are metadata, not measurements, when scanning an object for numbers. */
const NON_MEASUREMENT_KEYS = new Set([
  ...TIME_KEYS,
  ...QUALITY_KEYS,
  "seq",
  "id",
  "name",
  "unit",
  "units",
  "uom",
  "device",
  "deviceId",
  "sensor",
  "sensorId",
  "topic",
  "type",
]);

const lc = (s: string) => s.toLowerCase();

/** Case-insensitive lookup so `Value`, `VALUE` and `value` all resolve. */
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  const lowered = new Map(Object.keys(obj).map((k) => [lc(k), k]));
  for (const key of keys) {
    const actual = lowered.get(lc(key));
    if (actual !== undefined && obj[actual] !== undefined && obj[actual] !== null) {
      return obj[actual];
    }
  }
  return undefined;
}

/**
 * Coerce a wire value to a number.
 * Handles "3.14", "3.14 kW", "-1,5" (German decimal comma), true/false.
 * Returns null when there is no sensible number — callers must not invent one.
 */
export function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (/^true$/i.test(trimmed)) return 1;
  if (/^false$/i.test(trimmed)) return 0;

  // Leading number, optionally followed by a unit: "3.14 kW", "-2,5MW", "1e3"
  const match = trimmed.match(/^[+-]?(\d+([.,]\d+)?|[.,]\d+)([eE][+-]?\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0].replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Normalise any plausible timestamp to UTC ISO-8601 with an explicit offset.
 *
 * ASSUMPTION worth confirming on site: an offset-less string such as
 * "2026-08-11 08:30:00" is treated as UTC, not as plant-local time. If 2G's
 * gateway emits local time without an offset, flip UTC_WHEN_NAIVE to false —
 * that single constant is the entire fix.
 */
const UTC_WHEN_NAIVE = true;

export function toUtcIso(raw: unknown): string | undefined {
  if (raw == null) return undefined;

  if (typeof raw === "number" || (typeof raw === "string" && /^\d{9,14}$/.test(raw.trim()))) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) return undefined;
    // Disambiguate epoch seconds from epoch milliseconds. 1e12 ms ~= Sep 2001,
    // so anything below it is far more likely to be seconds.
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  if (typeof raw !== "string") return undefined;
  let s = raw.trim();
  if (s === "") return undefined;

  const hasOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  if (!hasOffset && UTC_WHEN_NAIVE) {
    s = s.replace(" ", "T") + "Z";
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function qualityFrom(raw: unknown): "ok" | "error" | undefined {
  if (raw == null) return undefined;
  const s = String(raw).toLowerCase();
  if (["bad", "error", "fault", "uncertain", "0", "false"].includes(s)) return "error";
  if (["good", "ok", "1", "true"].includes(s)) return "ok";
  return undefined;
}

/**
 * Parse one wire payload into zero or more samples.
 * Returns [] rather than throwing — a malformed payload must never take the
 * pipeline down, and the caller records it as an unparsable topic instead.
 */
export function parsePayload(payload: string): ParsedSample[] {
  const trimmed = (payload ?? "").trim();
  if (trimmed === "") return [];

  // Fast path: bare scalar, no JSON involved.
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    const value = toNumber(trimmed);
    return value === null ? [] : [{ value }];
  }

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    // Malformed JSON that still starts with '{' — try the scalar reading anyway.
    const value = toNumber(trimmed);
    return value === null ? [] : [{ value }];
  }

  return samplesFrom(json);
}

function samplesFrom(json: unknown, depth = 0): ParsedSample[] {
  if (depth > 4) return [];

  if (typeof json === "number" || typeof json === "boolean") {
    const value = toNumber(json);
    return value === null ? [] : [{ value }];
  }

  if (Array.isArray(json)) {
    return json.flatMap((entry) => samplesFrom(entry, depth + 1));
  }

  if (typeof json !== "object" || json === null) return [];

  const obj = json as Record<string, unknown>;
  const at = toUtcIso(pick(obj, TIME_KEYS));
  const qualityHint = qualityFrom(pick(obj, QUALITY_KEYS));

  // Sparkplug-ish: { metrics: [{ name, value, timestamp }] }
  const metrics = pick(obj, ["metrics"]);
  if (Array.isArray(metrics)) {
    return metrics.flatMap((m) => {
      if (typeof m !== "object" || m === null) return [];
      const metric = m as Record<string, unknown>;
      const value = toNumber(pick(metric, VALUE_KEYS));
      if (value === null) return [];
      const name = pick(metric, ["name", "alias"]);
      return [
        {
          value,
          at: toUtcIso(pick(metric, TIME_KEYS)) ?? at,
          subKey: typeof name === "string" ? name : undefined,
          qualityHint: qualityFrom(pick(metric, QUALITY_KEYS)) ?? qualityHint,
        },
      ];
    });
  }

  // Explicit value key: the common case.
  const direct = toNumber(pick(obj, VALUE_KEYS));
  if (direct !== null) return [{ value: direct, at, qualityHint }];

  // Nested container: { d: {...} }, { data: {...} }
  const container = pick(obj, CONTAINER_KEYS);
  if (container !== undefined && typeof container === "object" && container !== null) {
    const inner = samplesFrom(container, depth + 1);
    // Timestamps often sit on the envelope rather than the inner object.
    return inner.map((s) => ({ ...s, at: s.at ?? at, qualityHint: s.qualityHint ?? qualityHint }));
  }

  // Last resort: treat every numeric non-metadata key as its own measurement.
  // This is what makes {"power": 3.14, "temp": 61} work without configuration.
  const samples: ParsedSample[] = [];
  for (const [key, raw] of Object.entries(obj)) {
    if (NON_MEASUREMENT_KEYS.has(lc(key))) continue;
    const value = toNumber(raw);
    if (value !== null) samples.push({ value, at, subKey: key, qualityHint });
  }
  return samples;
}
