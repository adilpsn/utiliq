/**
 * Telemetry domain types.
 *
 * These are deliberately independent of MQTT. Nothing here mentions brokers,
 * topics-as-truth, QoS or payload shapes — those live behind parse.ts. If every
 * assumption about 2G's broker turns out to be wrong, these types survive.
 */

/** Quality of a reading. `stale` is derived, not transmitted. */
export type ReadingQuality = "ok" | "stale" | "error";

/**
 * One measurement at one instant. This is the canonical internal shape —
 * everything on the wire is normalised into this before it enters the app.
 *
 * `at` is ALWAYS a UTC ISO-8601 string with offset (e.g. "2026-08-11T08:30:00Z").
 * v1 emitted offset-less local strings, which would silently shift incoming
 * UTC payloads by the local offset (+2 in Münster). Do not relax this.
 */
export type Reading = {
  sensorId: string;
  /** Value AFTER unit scaling and sign normalisation — always in the sensor's `unit`. */
  value: number;
  at: string;
  quality: ReadingQuality;
  /** Untouched wire value, kept for debugging the mapping without a broker round-trip. */
  rawValue?: number;
  /** Topic (or other source address) this came from. */
  source?: string;
};

/**
 * A physical measurement point. Distinct from PlantResource on purpose: one
 * machine typically has several sensors (power, temperature, speed), which a
 * single `currentMW` field on the resource cannot express.
 */
export type Sensor = {
  id: string;
  label: string;
  /** FK to PlantResource.id — e.g. "TB-01". Optional: a sensor may arrive before its resource exists. */
  resourceId?: string;
  /** What is measured: "power" | "temperature" | ... Free-form by design; agreed on site. */
  measurement: string;
  /** Canonical unit AFTER scaling, e.g. "MW". */
  unit: string;
  /** Seconds without an update before the reading is treated as stale. */
  staleAfterSeconds: number;
  expectedMin?: number;
  expectedMax?: number;

  // --- map placement (see the live-map plan in the audit) --------------------
  /** Zone this sensor is shown on. Undefined => appears in the unplaced tray. */
  zoneId?: string;
  /** Normalised 0..1 position within the zone image. NEVER store pixels. */
  x?: number;
  y?: number;
  /** For sensors inside closed cabinets: offset the label away from the marker. */
  calloutOffset?: { dx: number; dy: number };
  /** False when the sensor is not physically visible in the zone photo. */
  visibleInPhoto?: boolean;
};

/** A photographed area of the plant, backing the live map. */
export type Zone = {
  id: string;
  name: string;
  /** Path under /public. Never inline base64 — the store is JSON-stringified to localStorage. */
  imagePath: string;
  /** width / height of the image. Required so markers do not drift; `contain`-fit only. */
  aspect: number;
};

/**
 * Wire address -> sensor, plus the two corrections that most often go wrong in
 * energy integrations. Both are free to carry and cost a config change rather
 * than a code change when the on-site answer contradicts the assumption:
 *
 *   scale  — their gear reports kW, Utiliq works in MW  => scale 0.001
 *   invert — their "generation positive" vs Utiliq's "consumption negative"
 */
export type TagMapping = {
  id: string;
  /** MQTT-style pattern with `+` (one segment) and `#` (rest). E.g. "2g/+/+/TB-01/power". */
  pattern: string;
  sensorId: string;
  /**
   * Optional: pull the resource id out of the topic instead of hardcoding one
   * mapping per bench. 0-based index into the topic's `/`-separated segments.
   */
  resourceIdFromSegment?: number;
  /** Multiply the wire value by this. 0.001 for kW->MW. Default 1. */
  scale: number;
  /** Flip the sign after scaling. Default false. */
  invert: boolean;
  /** Human note recorded on site — who confirmed the unit and sign. */
  note?: string;
};

/** A topic seen on the wire that no mapping claimed. Surfaced, never dropped silently. */
export type UnmappedTopic = {
  topic: string;
  samplePayload: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
};

export type ConnectionState = "disabled" | "connecting" | "open" | "retrying" | "error";

export type ConnectionStatus = {
  state: ConnectionState;
  /** Collector URL currently targeted. */
  url: string;
  since: string;
  lastMessageAt?: string;
  messagesReceived: number;
  lastError?: string;
};

/** One raw frame as delivered by the collector. The collector does not interpret payloads. */
export type WireFrame = {
  topic: string;
  payload: string;
  /** Broker/collector receive time, UTC ISO. Used only when the payload carries no timestamp. */
  receivedAt: string;
};
