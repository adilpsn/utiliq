/**
 * Parser + mapping tests.
 *
 * Run with:  npm run test:telemetry
 *
 * These are the assumption-free half of the pipeline: whatever 2G's broker
 * turns out to look like, "3.14 kW" is still 3.14 and epoch seconds are still
 * seconds. If the site visit invalidates a shape, delete its case and add the
 * real one — the test file is the specification of what the wire may contain.
 */
import { parsePayload, toNumber, toUtcIso } from "./parse";
import { DEFAULT_MAPPINGS, applyMapping, matchTopic, resolveMapping } from "./mapping";

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed += 1;
  else failures.push(`${name}\n    expected: ${e}\n    actual:   ${a}`);
}

// --- toNumber --------------------------------------------------------------
check("bare number", toNumber(3.14), 3.14);
check("numeric string", toNumber("3.14"), 3.14);
check("negative", toNumber("-2110"), -2110);
check("unit suffix", toNumber("1980.5 kW"), 1980.5);
check("unit suffix no space", toNumber("-2,5MW"), -2.5);
check("german decimal comma", toNumber("3,7"), 3.7);
check("scientific", toNumber("1e3"), 1000);
check("boolean true", toNumber(true), 1);
check("boolean false", toNumber(false), 0);
check("string true", toNumber("true"), 1);
check("non-numeric string is null", toNumber("RUNNING"), null);
check("empty string is null", toNumber(""), null);
check("NaN is null", toNumber(Number.NaN), null);

// --- toUtcIso --------------------------------------------------------------
check("epoch seconds", toUtcIso(1786399200), "2026-08-10T22:00:00.000Z");
check("epoch millis", toUtcIso(1786399200000), "2026-08-10T22:00:00.000Z");
check("epoch seconds as string", toUtcIso("1786399200"), "2026-08-10T22:00:00.000Z");
check("iso with Z", toUtcIso("2026-08-11T06:30:00Z"), "2026-08-11T06:30:00.000Z");
check("iso with offset", toUtcIso("2026-08-11T08:30:00+02:00"), "2026-08-11T06:30:00.000Z");
// The naive case is the dangerous one: v1 emitted offset-less local strings.
check("naive treated as UTC", toUtcIso("2026-08-11 06:30:00"), "2026-08-11T06:30:00.000Z");
check("garbage is undefined", toUtcIso("not a date"), undefined);
check("null is undefined", toUtcIso(null), undefined);

// --- parsePayload ----------------------------------------------------------
check("scalar payload", parsePayload("3412.5"), [{ value: 3412.5 }]);
check("scalar with unit", parsePayload("1980.5 kW"), [{ value: 1980.5 }]);
check("json value key", parsePayload('{"value": 2870.4}'), [
  { value: 2870.4, at: undefined, qualityHint: undefined },
]);
check("terse v + ts", parsePayload('{"v": 3180.2, "ts": 1786399200}'), [
  { value: 3180.2, at: "2026-08-10T22:00:00.000Z", qualityHint: undefined },
]);
check(
  "value + iso timestamp + quality",
  parsePayload('{"value": -2110, "timestamp": "2026-08-11T06:30:00Z", "quality": "good"}'),
  [{ value: -2110, at: "2026-08-11T06:30:00.000Z", qualityHint: "ok" }],
);
check("bad quality flag", parsePayload('{"value": 5, "quality": "bad"}'), [
  { value: 5, at: undefined, qualityHint: "error" },
]);
check(
  "nested container, multi-measurement",
  parsePayload('{"d": {"power": 3399.4, "temperature": 61.2}, "ts": 1786399260}'),
  [
    { value: 3399.4, at: "2026-08-10T22:01:00.000Z", subKey: "power", qualityHint: undefined },
    { value: 61.2, at: "2026-08-10T22:01:00.000Z", subKey: "temperature", qualityHint: undefined },
  ],
);
check(
  "sparkplug metrics array",
  parsePayload(
    '{"timestamp": 1786399270000, "metrics": [{"name": "power", "value": 2881}, {"name": "temperature", "value": 58.9}]}',
  ),
  [
    { value: 2881, at: "2026-08-10T22:01:10.000Z", subKey: "power", qualityHint: undefined },
    { value: 58.9, at: "2026-08-10T22:01:10.000Z", subKey: "temperature", qualityHint: undefined },
  ],
);
check("non-numeric payload yields nothing", parsePayload("RUNNING"), []);
check(
  "string-valued json yields nothing",
  parsePayload('{"mode": "load-test", "operator": "MK"}'),
  [],
);
check("empty payload yields nothing", parsePayload(""), []);
check("malformed json does not throw", parsePayload("{not json"), []);
// Metadata keys must not be mistaken for measurements.
check("metadata keys ignored", parsePayload('{"seq": 12, "unit": "kW", "power": 7}'), [
  { value: 7, at: undefined, subKey: "power", qualityHint: undefined },
]);

// --- matchTopic ------------------------------------------------------------
check("exact match", matchTopic("a/b/c", "a/b/c")?.length, 3);
check("plus wildcard", matchTopic("a/b/c", "a/+/c")?.length, 3);
check("hash wildcard", matchTopic("a/b/c/d/e", "a/b/#")?.length, 5);
check("length mismatch rejected", matchTopic("a/b", "a/b/c"), null);
check("longer topic rejected without hash", matchTopic("a/b/c/d", "a/b/c"), null);
check("segment mismatch rejected", matchTopic("a/x/c", "a/b/c"), null);
check(
  "case-insensitive segments",
  matchTopic("utiliq/2g/hallB/TB-01/power", "utiliq/2g/hallb/+/power")?.length,
  5,
);

// --- resolve + apply (the assumptions under test) --------------------------
const resolved = resolveMapping("utiliq/2g/hallB/TB-01/power", undefined, DEFAULT_MAPPINGS);
check("generic power mapping resolves", resolved?.mapping.id, "power-generic");

if (resolved) {
  const reading = applyMapping(
    { value: 3412.5 },
    resolved.mapping,
    resolved.segments,
    "2026-08-10T22:00:00.000Z",
  );
  // kW -> MW scaling is the single most likely assumption to be wrong, and the
  // single cheapest to correct: one number in the mapping table.
  check("kW scaled to MW", reading.value, 3.4125);
  check("raw value preserved", reading.rawValue, 3412.5);
  check("resource id lifted from topic segment", reading.sensorId, "TB-01.power");
  check("receivedAt used when payload has no timestamp", reading.at, "2026-08-10T22:00:00.000Z");
}

// Explicit-unit topics must NOT be re-scaled.
const mwResolved = resolveMapping("utiliq/2g/hallB/TB-01/power_mw", undefined, DEFAULT_MAPPINGS);
check("explicit MW topic resolves", mwResolved?.mapping.id, "power-mw-explicit");
if (mwResolved) {
  check(
    "explicit MW not rescaled",
    applyMapping(
      { value: 3.4 },
      mwResolved.mapping,
      mwResolved.segments,
      "2026-08-10T22:00:00.000Z",
    ).value,
    3.4,
  );
}

// Sign convention: flipping `invert` must flip the delivered value.
if (resolved) {
  const inverted = applyMapping(
    { value: 3412.5 },
    { ...resolved.mapping, invert: true },
    resolved.segments,
    "2026-08-10T22:00:00.000Z",
  );
  check("invert flips sign", inverted.value, -3.4125);
}

// subKey from a nested payload must route as if it were its own topic.
const subResolved = resolveMapping("utiliq/2g/hallB/TB-01", "power", DEFAULT_MAPPINGS);
check("subKey routes like a topic segment", subResolved?.mapping.id, "power-generic");

// Unknown trees must resolve to nothing, so they surface in the unmapped tray.
check(
  "unknown topic is unmapped",
  resolveMapping("plant/legacy/scada/tag4711", undefined, DEFAULT_MAPPINGS),
  null,
);

// --- report ----------------------------------------------------------------
if (failures.length === 0) {
  console.log(`telemetry: ${passed} assertions passed`);
} else {
  console.error(`telemetry: ${passed} passed, ${failures.length} FAILED\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
