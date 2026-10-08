import { differenceInMinutes, isBefore, parseISO } from "date-fns";
import type {
  EnergyConstraint,
  PlantResource,
  PowerProfilePoint,
  ScheduleAssignment,
  TestItem,
} from "./utiliq-types";

/**
 * The plant's energy balance — the single place grid flow is computed.
 *
 * Before this module the Command Center (engine) and the Live Energy page each
 * had their own formula, and they disagreed: the engine ignored every resource
 * that was not a test bench. Everything that needs a grid number — forecast,
 * cap warnings, the scheduler's slot scoring, KPIs, spot-market analysis and
 * the Live Energy page — now calls plantBalanceAt().
 *
 * Sign convention, everywhere: **positive = supplies the plant bus**
 * (generation, battery discharge, a CHP under test), **negative = draws from
 * it** (loads, battery charging). gridMW follows from that: positive = export,
 * negative = import.
 *
 * Open assumption — persistence: non-bench resources have no time profile yet,
 * so their *current* value is used for every `at`, past or future. A forecast
 * therefore holds PV output constant overnight. Replace with per-resource
 * profiles or live telemetry once either exists.
 */

/**
 * Fixed power (MW, not a fraction of test power — the old names suggested
 * otherwise) drawn or delivered while a unit is being set up / cooling down.
 * The sign follows the first / last point of the unit's profile.
 */
export const SETUP_POWER_MW = 0.25;
export const COOLDOWN_POWER_MW = 0.2;

export type BalanceInput = {
  assignments: ScheduleAssignment[];
  items: TestItem[];
  resources: PlantResource[];
  constraint: EnergyConstraint;
};

export type PlantBalance = {
  /** Net power of all units under test (assignments active at `at`). */
  benchesMW: number;
  /** Net power of every other resource except grid and battery (PV, loads, …). */
  onSiteMW: number;
  /** + discharging, − charging. */
  batteryMW: number;
  /** Plant-wide base load, as a positive number. Subtracted from the balance. */
  baseLoadMW: number;
  /** + export, − import. */
  gridMW: number;
};

export function powerAtOffset(profile: PowerProfilePoint[], offsetMinutes: number) {
  const sorted = [...profile].sort((a, b) => a.offsetMinutes - b.offsetMinutes);
  let active = sorted[0]?.powerMW ?? 0;
  for (const point of sorted) {
    if (point.offsetMinutes <= offsetMinutes) active = point.powerMW;
    else break;
  }
  return active;
}

/** Power of one scheduled test at `at`; 0 outside [start, end). */
export function powerForAssignmentAt(
  assignment: ScheduleAssignment,
  item: TestItem | undefined,
  at: Date,
) {
  if (!item) return 0;
  const start = parseISO(assignment.start);
  const end = parseISO(assignment.end);
  if (isBefore(at, start) || !isBefore(at, end)) return 0;
  const minutes = differenceInMinutes(at, start);
  if (minutes < item.setupTimeMinutes)
    return Math.sign(powerAtOffset(item.expectedPowerProfile, 0)) * SETUP_POWER_MW;
  const testOffset = minutes - item.setupTimeMinutes;
  const testMinutes = Math.round(item.estimatedDurationHours * 60);
  if (testOffset > testMinutes)
    return Math.sign(powerAtOffset(item.expectedPowerProfile, testMinutes)) * COOLDOWN_POWER_MW;
  return powerAtOffset(item.expectedPowerProfile, testOffset);
}

/** Whether a resource's power comes from `currentMW` (as opposed to schedules or the balance). */
export function isMeteredResource(resource: PlantResource) {
  return resource.type !== "Grid" && resource.type !== "Test Bench";
}

/**
 * Signed MW of a metered (non-grid, non-bench) resource.
 *
 * Battery direction is taken from `status`, not from the sign of currentMW,
 * because the demo data stores battery power as a magnitude.
 */
export function resourcePowerMW(resource: PlantResource) {
  const raw = resource.currentMW ?? 0;
  if (resource.type !== "Battery") return raw;
  if (resource.status === "charging") return -Math.abs(raw);
  if (resource.status === "discharging") return Math.abs(raw);
  return raw;
}

export function plantBalanceAt(input: BalanceInput, at: Date): PlantBalance {
  const benchesMW = input.assignments.reduce((sum, assignment) => {
    const item = input.items.find((candidate) => candidate.id === assignment.testItemId);
    return sum + powerForAssignmentAt(assignment, item, at);
  }, 0);
  let onSiteMW = 0;
  let batteryMW = 0;
  for (const resource of input.resources) {
    if (!isMeteredResource(resource)) continue;
    if (resource.type === "Battery") batteryMW += resourcePowerMW(resource);
    else onSiteMW += resourcePowerMW(resource);
  }
  const baseLoadMW = input.constraint.facilityBaseLoadMW;
  return {
    benchesMW,
    onSiteMW,
    batteryMW,
    baseLoadMW,
    gridMW: benchesMW + onSiteMW + batteryMW - baseLoadMW,
  };
}
