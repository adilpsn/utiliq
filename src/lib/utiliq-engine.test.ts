/**
 * Engine + energy-balance tests.
 *
 * Run with:  npm run test:engine   (or `npm test` for every suite)
 *
 * Same no-runner style as telemetry/parse.test.ts. Runs against the demo state,
 * with the clock frozen at DEMO_NOW (telemetry flag off).
 */
import { addMinutes } from "date-fns";
import {
  COOLDOWN_POWER_MW,
  SETUP_POWER_MW,
  plantBalanceAt,
  powerForAssignmentAt,
  resourcePowerMW,
} from "./energy-balance";
import {
  autoSchedule,
  buildEnergyForecast,
  calculateKpis,
  getAssignmentWarnings,
  gridFlowAt,
  isBenchCompatible,
  overlaps,
  parseDate,
} from "./utiliq-engine";
import { DEMO_NOW, createDemoState } from "./utiliq-demo-data";
import type { PlantResource, ScheduleAssignment, TestItem, UtiliqState } from "./utiliq-types";

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed += 1;
  else failures.push(`${name}\n    expected: ${e}\n    actual:   ${a}`);
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const now = parseDate(DEMO_NOW);
const balanceOf = (state: UtiliqState, at: Date) =>
  plantBalanceAt(
    {
      assignments: state.assignments,
      items: state.testItems,
      resources: state.resources,
      constraint: state.energyConstraint,
    },
    at,
  );

function resource(patch: Partial<PlantResource> & Pick<PlantResource, "type">): PlantResource {
  return {
    id: `R-${patch.type}`,
    name: patch.type,
    status: "running",
    location: "",
    currentMW: 0,
    ...patch,
  };
}

// --- resourcePowerMW: sign conventions ---------------------------------------
check("PV supplies the bus", resourcePowerMW(resource({ type: "PV", currentMW: 0.4 })), 0.4);
check(
  "load draws from the bus",
  resourcePowerMW(resource({ type: "Cooling", currentMW: -0.9 })),
  -0.9,
);
check(
  "battery charging is negative",
  resourcePowerMW(resource({ type: "Battery", status: "charging", currentMW: 0.2 })),
  -0.2,
);
check(
  "battery discharging is positive",
  resourcePowerMW(resource({ type: "Battery", status: "discharging", currentMW: -0.3 })),
  0.3,
);

// --- plantBalanceAt: the one formula -----------------------------------------
{
  const state = createDemoState();
  const b = balanceOf(state, now);
  check("no assignments → benches contribute 0", b.benchesMW, 0);
  check(
    "grid = benches + on-site + battery − base load",
    round(b.gridMW),
    round(b.benchesMW + b.onSiteMW + b.batteryMW - b.baseLoadMW),
  );
  check("base load subtracted", b.baseLoadMW, state.energyConstraint.facilityBaseLoadMW);
  // Demo: PV 0.4 + 0.5, load bank −1.8, chiller −0.9, compressor −0.6; battery charging 0.2.
  check("demo on-site net", round(b.onSiteMW), -2.4);
  check("demo battery", round(b.batteryMW), -0.2);
  check("grid and test-bench resources are not metered", round(b.gridMW), round(-2.4 - 0.2 - 1.4));

  // The old engine formula ignored all of this; gridFlowAt must now agree.
  check(
    "gridFlowAt === plantBalanceAt.gridMW",
    gridFlowAt(state.assignments, state.testItems, state.resources, state.energyConstraint, now),
    b.gridMW,
  );
  check("Command Center KPI uses the same number", calculateKpis(state).currentGrid, b.gridMW);

  // Live Energy bus: sources (incl. grid import) must equal consumers (incl. export).
  const metered = state.resources.filter((r) => r.type !== "Grid" && r.type !== "Test Bench");
  const flows = metered.map(resourcePowerMW);
  const supply = flows.filter((v) => v > 0).reduce((s, v) => s + v, 0) + Math.max(0, -b.gridMW);
  const demand =
    Math.abs(flows.filter((v) => v < 0).reduce((s, v) => s + v, 0)) +
    b.baseLoadMW +
    Math.max(0, b.gridMW);
  check("Live Energy bus balances", round(supply), round(demand));

  // Persistence: with no tests running, every forecast hour has the same grid flow.
  const forecast = buildEnergyForecast(state, now);
  check("forecast has 24 hours", forecast.length, 24);
  check(
    "persistence: non-bench MW is constant across the day",
    new Set(forecast.map((point) => point.gridMW)).size,
    1,
  );

  // Editing a resource moves the grid by exactly that amount.
  const pvUp = {
    ...state,
    resources: state.resources.map((r) =>
      r.id === "PV-01" ? { ...r, currentMW: r.currentMW + 1 } : r,
    ),
  };
  check("PV +1 MW → grid +1 MW", round(balanceOf(pvUp, now).gridMW - b.gridMW), 1);
}

// --- powerForAssignmentAt: phases and boundaries ------------------------------
{
  const item: TestItem = {
    ...createDemoState().testItems[0],
    setupTimeMinutes: 30,
    estimatedDurationHours: 2,
    cooldownTimeMinutes: 30,
    expectedPowerProfile: [
      { offsetMinutes: 0, powerMW: 2 },
      { offsetMinutes: 60, powerMW: 3 },
    ],
  };
  const start = parseDate("2026-06-02T08:00:00");
  const assignment: ScheduleAssignment = {
    id: "sa-test",
    testItemId: item.id,
    benchId: "TB-01",
    start: "2026-06-02T08:00:00",
    end: "2026-06-02T11:00:00",
    locked: false,
  };
  const at = (minutes: number) =>
    powerForAssignmentAt(assignment, item, addMinutes(start, minutes));
  check("before start → 0", at(-1), 0);
  check("at start → setup power", at(0), SETUP_POWER_MW);
  check("first profile point", at(30), 2);
  check("second profile point", at(30 + 60), 3);
  check("cooldown power", at(30 + 121), COOLDOWN_POWER_MW);
  check("at end → 0 (end exclusive)", at(180), 0);
  check("unknown item → 0", powerForAssignmentAt(assignment, undefined, start), 0);
}

// --- autoSchedule ----------------------------------------------------------------
{
  const state = createDemoState();
  const first = autoSchedule(state);
  const second = autoSchedule(createDemoState());
  check("autoSchedule schedules something", first.created.length > 0, true);
  check(
    "autoSchedule is deterministic",
    first.assignments.map((a) => `${a.testItemId}@${a.benchId}@${a.start}`),
    second.assignments.map((a) => `${a.testItemId}@${a.benchId}@${a.start}`),
  );

  let overlapping = 0;
  for (const a of first.assignments)
    for (const b of first.assignments)
      if (a.id !== b.id && a.benchId === b.benchId && overlaps(a.start, a.end, b.start, b.end))
        overlapping += 1;
  check("no two tests overlap on one bench", overlapping, 0);

  const incompatible = first.assignments.filter((a) => {
    const item = first.testItems.find((candidate) => candidate.id === a.testItemId);
    const bench = first.benches.find((candidate) => candidate.id === a.benchId);
    return !item || !bench || !isBenchCompatible(item, bench);
  });
  check("only compatible benches are used", incompatible.length, 0);
}

// --- getAssignmentWarnings: grid caps follow the balance -----------------------
{
  const state = createDemoState();
  const item = state.testItems[0];
  const assignment: ScheduleAssignment = {
    id: "sa-cap",
    testItemId: item.id,
    benchId: item.compatibleBenchIds[0],
    start: DEMO_NOW,
    end: "2026-06-02T14:30:00",
    locked: false,
  };
  const warnTypes = (resources: PlantResource[]) =>
    getAssignmentWarnings(
      assignment,
      [assignment],
      state.testItems,
      state.benches,
      resources,
      state.energyConstraint,
    ).map((warning) => warning.type);

  const heavyLoad = [
    ...state.resources,
    resource({ type: "Load Bank", id: "LB-TEST", currentMW: -20 }),
  ];
  check(
    "import-cap warning when on-site load pushes import past the cap",
    warnTypes(heavyLoad).includes("grid_import_cap_exceeded"),
    true,
  );
  const bigPv = [...state.resources, resource({ type: "PV", id: "PV-TEST", currentMW: 20 })];
  check(
    "export-cap warning when on-site generation pushes export past the cap",
    warnTypes(bigPv).includes("grid_export_cap_exceeded"),
    true,
  );
}

// --- report ----------------------------------------------------------------
if (failures.length === 0) {
  console.log(`engine: ${passed} assertions passed`);
} else {
  console.error(`engine: ${passed} passed, ${failures.length} FAILED\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
