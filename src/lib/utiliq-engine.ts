import {
  addDays,
  addMinutes,
  differenceInMinutes,
  format,
  isAfter,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
} from "date-fns";
import { DEMO_NOW } from "./utiliq-demo-data";
import type {
  EnergyConstraint,
  OptimizationSettings,
  PowerProfilePoint,
  ScheduleAssignment,
  ScheduleWarning,
  TestBench,
  TestItem,
  TestRecord,
  UtiliqState,
} from "./utiliq-types";

export const parseDate = (value: string) => parseISO(value);

/** Fraction of peak power drawn during setup phase (not yet at full test load) */
const SETUP_POWER_FACTOR = 0.25;
/** Fraction of peak power drawn during cooldown phase */
const COOLDOWN_POWER_FACTOR = 0.2;
export const toIsoLocal = (date: Date) => format(date, "yyyy-MM-dd'T'HH:mm:ss");
export const formatDate = (value: string) => format(parseDate(value), "dd MMM");
export const formatDateTime = (value: string) => format(parseDate(value), "dd MMM HH:mm");
export const formatTime = (value: string) => format(parseDate(value), "HH:mm");
export const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins}m`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
};

const priorityRank: Record<TestItem["priority"], number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const priorityCost: Record<TestItem["priority"], number> = {
  urgent: 900,
  high: 420,
  normal: 160,
  low: 40,
};

const presetWeights: Record<
  OptimizationSettings["preset"],
  Partial<OptimizationSettings["weights"]>
> = {
  balanced: {},
  "deadline-first": {
    meetDeadlines: 100,
    avoidGridCaps: 78,
    reduceEnergyCost: 38,
    maximizeUtilization: 54,
  },
  "cost-optimized": {
    reduceEnergyCost: 100,
    minimizeCurtailment: 86,
    meetDeadlines: 62,
    avoidGridCaps: 74,
  },
  "grid-safe": {
    avoidGridCaps: 100,
    minimizeCurtailment: 92,
    meetDeadlines: 70,
    reduceEnergyCost: 52,
  },
  throughput: {
    maximizeUtilization: 100,
    reduceOvertime: 72,
    meetDeadlines: 70,
    avoidGridCaps: 64,
  },
};

export function effectiveWeights(settings: OptimizationSettings) {
  return { ...settings.weights, ...presetWeights[settings.preset] };
}

export function totalTestMinutes(item: TestItem) {
  return (
    item.setupTimeMinutes + Math.round(item.estimatedDurationHours * 60) + item.cooldownTimeMinutes
  );
}

export function assignmentDurationMinutes(assignment: ScheduleAssignment) {
  return differenceInMinutes(parseDate(assignment.end), parseDate(assignment.start));
}

export function overlaps(
  startA: string | Date,
  endA: string | Date,
  startB: string | Date,
  endB: string | Date,
) {
  const aStart = typeof startA === "string" ? parseDate(startA) : startA;
  const aEnd = typeof endA === "string" ? parseDate(endA) : endA;
  const bStart = typeof startB === "string" ? parseDate(startB) : startB;
  const bEnd = typeof endB === "string" ? parseDate(endB) : endB;
  return isBefore(aStart, bEnd) && isAfter(aEnd, bStart);
}

export function isBenchCompatible(item: TestItem, bench: TestBench) {
  const benchSupportsRecipe = bench.compatibleRecipeIds?.includes(item.testRecipeId) ?? false;
  if (!item.compatibleBenchIds.includes(bench.id) && !benchSupportsRecipe) return false;
  if (bench.compatibleRecipeIds?.length && !benchSupportsRecipe) return false;
  const minProfilePower = Math.min(...item.expectedPowerProfile.map((point) => point.powerMW));
  const maxProfilePower = Math.max(...item.expectedPowerProfile.map((point) => point.powerMW));
  const benchMin = bench.minPowerMW ?? 0;
  return minProfilePower >= benchMin - 0.05 && maxProfilePower <= bench.maxPowerMW + 0.05;
}

export function powerAtOffset(profile: PowerProfilePoint[], offsetMinutes: number) {
  const sorted = [...profile].sort((a, b) => a.offsetMinutes - b.offsetMinutes);
  let active = sorted[0]?.powerMW ?? 0;
  for (const point of sorted) {
    if (point.offsetMinutes <= offsetMinutes) active = point.powerMW;
    else break;
  }
  return active;
}

export function powerForAssignmentAt(
  assignment: ScheduleAssignment,
  item: TestItem | undefined,
  at: Date,
) {
  if (!item) return 0;
  const start = parseDate(assignment.start);
  const end = parseDate(assignment.end);
  if (isBefore(at, start) || !isBefore(at, end)) return 0;
  const minutes = differenceInMinutes(at, start);
  if (minutes < item.setupTimeMinutes)
    return Math.sign(powerAtOffset(item.expectedPowerProfile, 0)) * SETUP_POWER_FACTOR;
  const testOffset = minutes - item.setupTimeMinutes;
  const testMinutes = Math.round(item.estimatedDurationHours * 60);
  if (testOffset > testMinutes)
    return Math.sign(powerAtOffset(item.expectedPowerProfile, testMinutes)) * COOLDOWN_POWER_FACTOR;
  return powerAtOffset(item.expectedPowerProfile, testOffset);
}

export function integrateProfileMWh(item: TestItem, stepMinutes = 30) {
  const totalMinutes = totalTestMinutes(item);
  let generated = 0;
  let consumed = 0;
  for (let minute = 0; minute < totalMinutes; minute += stepMinutes) {
    let power = 0;
    if (minute < item.setupTimeMinutes) {
      power = Math.sign(powerAtOffset(item.expectedPowerProfile, 0)) * SETUP_POWER_FACTOR;
    } else if (minute > item.setupTimeMinutes + item.estimatedDurationHours * 60) {
      power =
        Math.sign(powerAtOffset(item.expectedPowerProfile, item.estimatedDurationHours * 60)) *
        COOLDOWN_POWER_FACTOR;
    } else {
      power = powerAtOffset(item.expectedPowerProfile, minute - item.setupTimeMinutes);
    }
    const mwh = Math.abs(power) * (stepMinutes / 60);
    if (power >= 0) generated += mwh;
    else consumed += mwh;
  }
  return { generated, consumed };
}

export function gridFlowAt(
  assignments: ScheduleAssignment[],
  items: TestItem[],
  constraint: EnergyConstraint,
  at: Date,
) {
  const testPower = assignments.reduce((sum, assignment) => {
    const item = items.find((candidate) => candidate.id === assignment.testItemId);
    return sum + powerForAssignmentAt(assignment, item, at);
  }, 0);
  return testPower - constraint.facilityBaseLoadMW;
}

export function buildEnergyForecast(state: UtiliqState, day = parseDate(DEMO_NOW)) {
  const date = startOfDay(day);
  return Array.from({ length: 24 }, (_, hour) => {
    const at = addMinutes(date, hour * 60);
    const gridMW = gridFlowAt(state.assignments, state.testItems, state.energyConstraint, at);
    const exportCap = state.energyConstraint.maxGridExportMW;
    const importCap = state.energyConstraint.maxGridImportMW;
    return {
      time: format(at, "HH:mm"),
      gridMW: Number(gridMW.toFixed(2)),
      exportCap,
      importCap: -importCap,
    };
  });
}

export function getAssignmentWarnings(
  assignment: ScheduleAssignment,
  assignments: ScheduleAssignment[],
  items: TestItem[],
  benches: TestBench[],
  constraint: EnergyConstraint,
) {
  const warnings: ScheduleWarning[] = [];
  const item = items.find((candidate) => candidate.id === assignment.testItemId);
  const bench = benches.find((candidate) => candidate.id === assignment.benchId);
  if (!item || !bench) return warnings;

  if (!isBenchCompatible(item, bench)) {
    warnings.push({
      type: "incompatible_bench",
      severity: "critical",
      message: `${bench.id} is not compatible with ${item.modelName}.`,
    });
  }

  const overlap = assignments.some((candidate) => {
    if (candidate.id === assignment.id || candidate.benchId !== assignment.benchId) return false;
    return overlaps(assignment.start, assignment.end, candidate.start, candidate.end);
  });
  if (overlap) {
    warnings.push({
      type: "overlapping_tests",
      severity: "critical",
      message: `${bench.id} has overlapping tests in this window.`,
    });
  }

  const maintenance = bench.maintenanceWindows?.find((window) =>
    overlaps(assignment.start, assignment.end, window.start, window.end),
  );
  if (maintenance) {
    warnings.push({
      type: "maintenance_conflict",
      severity: "critical",
      message: `${bench.id} maintenance overlaps this test: ${maintenance.reason}.`,
    });
  }

  if (isAfter(parseDate(assignment.end), parseDate(item.deadline))) {
    warnings.push({
      type: "deadline_risk",
      severity: "critical",
      message: `${item.serialNumber} finishes after its customer deadline.`,
    });
  } else if (differenceInMinutes(parseDate(item.deadline), parseDate(assignment.end)) < 24 * 60) {
    warnings.push({
      type: "deadline_risk",
      severity: "warning",
      message: `${item.serialNumber} finishes within 24 hours of its deadline.`,
    });
  }

  let maxExport = 0;
  let maxImport = 0;
  for (
    let at = parseDate(assignment.start);
    isBefore(at, parseDate(assignment.end));
    at = addMinutes(at, 30)
  ) {
    const flow = gridFlowAt(assignments, items, constraint, at);
    maxExport = Math.max(maxExport, flow);
    maxImport = Math.max(maxImport, -flow);
  }
  if (maxExport > constraint.maxGridExportMW) {
    warnings.push({
      type: "grid_export_cap_exceeded",
      severity: "warning",
      message: `Expected export peaks at ${maxExport.toFixed(1)} MW above the ${constraint.maxGridExportMW.toFixed(1)} MW cap.`,
    });
  }
  if (maxImport > constraint.maxGridImportMW) {
    warnings.push({
      type: "grid_import_cap_exceeded",
      severity: "warning",
      message: `Expected import peaks at ${maxImport.toFixed(1)} MW above the ${constraint.maxGridImportMW.toFixed(1)} MW cap.`,
    });
  }
  if (
    maxExport > constraint.maxGridExportMW * 0.9 &&
    (constraint.batteryStateOfChargePercent ?? 0) > 85
  ) {
    warnings.push({
      type: "low_battery_headroom",
      severity: "info",
      message: "Battery headroom is low for absorbing surplus test generation.",
    });
  }
  if (maxExport > constraint.maxGridExportMW * 0.95) {
    warnings.push({
      type: "high_curtailment_risk",
      severity: "warning",
      message: "High curtailment risk if the test runs without a matching import load.",
    });
  }
  return warnings;
}

function candidateSlotStarts(horizonDays = 7, incrementMinutes = 60) {
  const now = parseDate(DEMO_NOW);
  const first = addMinutes(now, 30 - (now.getMinutes() % 30));
  const starts: Date[] = [];
  for (let day = 0; day < horizonDays; day += 1) {
    const base = startOfDay(addDays(now, day));
    for (let hour = 6; hour <= 19; hour += 1) {
      const slot = addMinutes(base, hour * 60);
      if (isBefore(slot, first)) continue;
      if (incrementMinutes === 30) {
        starts.push(slot, addMinutes(slot, 30));
      } else {
        starts.push(slot);
      }
    }
  }
  return starts;
}

function slotHasHardConflict(
  candidate: ScheduleAssignment,
  assignments: ScheduleAssignment[],
  bench: TestBench,
) {
  const conflictsLocked = assignments.some(
    (assignment) =>
      assignment.benchId === candidate.benchId &&
      assignment.locked &&
      overlaps(candidate.start, candidate.end, assignment.start, assignment.end),
  );
  if (conflictsLocked) return true;
  const conflictsAny = assignments.some(
    (assignment) =>
      assignment.benchId === candidate.benchId &&
      overlaps(candidate.start, candidate.end, assignment.start, assignment.end),
  );
  if (conflictsAny) return true;
  return Boolean(
    bench.maintenanceWindows?.some((window) =>
      overlaps(candidate.start, candidate.end, window.start, window.end),
    ),
  );
}

function averagePriceForHour(hour: number, constraint: EnergyConstraint, exportFlow: boolean) {
  const profile = exportFlow ? constraint.feedInTariffProfile : constraint.electricityPriceProfile;
  if (!profile?.length) return exportFlow ? 58 : 150;
  const point =
    [...profile].reverse().find((candidate) => Number(candidate.time.slice(0, 2)) <= hour) ??
    profile[0];
  return point.eurPerMWh;
}

function scoreSlot(
  item: TestItem,
  bench: TestBench,
  candidate: ScheduleAssignment,
  assignments: ScheduleAssignment[],
  items: TestItem[],
  constraint: EnergyConstraint,
  settings: OptimizationSettings,
) {
  const weights = effectiveWeights(settings);
  const end = parseDate(candidate.end);
  const deadline = parseDate(item.deadline);
  const minutesLate = Math.max(0, differenceInMinutes(end, deadline));
  const minutesBeforeDeadline = differenceInMinutes(deadline, end);
  const deadlinePenalty =
    (minutesLate * 20 +
      Math.max(0, 36 * 60 - minutesBeforeDeadline) * 0.3 +
      priorityCost[item.priority]) *
    (weights.meetDeadlines / 100);

  let exportViolation = 0;
  let importViolation = 0;
  let curtailment = 0;
  let energyCost = 0;
  for (let at = parseDate(candidate.start); isBefore(at, end); at = addMinutes(at, 30)) {
    const flow = gridFlowAt([...assignments, candidate], items, constraint, at);
    exportViolation += Math.max(0, flow - constraint.maxGridExportMW);
    importViolation += Math.max(0, -flow - constraint.maxGridImportMW);
    curtailment += Math.max(0, flow - constraint.maxGridExportMW) * 0.5;
    const hour = at.getHours();
    if (flow >= 0) energyCost -= flow * 0.5 * averagePriceForHour(hour, constraint, true);
    else energyCost += Math.abs(flow) * 0.5 * averagePriceForHour(hour, constraint, false);
  }

  const gridPenalty = (exportViolation + importViolation) * 700 * (weights.avoidGridCaps / 100);
  const curtailmentPenalty = curtailment * 420 * (weights.minimizeCurtailment / 100);
  const costPenalty = energyCost * (weights.reduceEnergyCost / 100);
  const idleMinutes = Math.max(
    0,
    differenceInMinutes(parseDate(candidate.start), parseDate(DEMO_NOW)),
  );
  const benchIdlePenalty = idleMinutes * 0.03 * (weights.maximizeUtilization / 100);
  const overtimePenalty =
    (parseDate(candidate.end).getHours() >= 18 ? 280 : 0) * (weights.reduceOvertime / 100);
  const benchPreference = bench.id === item.compatibleBenchIds[0] ? -50 : 0;

  return (
    deadlinePenalty +
    gridPenalty +
    curtailmentPenalty +
    costPenalty +
    benchIdlePenalty +
    overtimePenalty +
    benchPreference
  );
}

function buildExplanation(
  item: TestItem,
  bench: TestBench,
  candidate: ScheduleAssignment,
  assignments: ScheduleAssignment[],
  items: TestItem[],
  constraint: EnergyConstraint,
) {
  const end = parseDate(candidate.end);
  const deadlineHours = Math.round(differenceInMinutes(parseDate(item.deadline), end) / 60);
  let peakExport = 0;
  for (let at = parseDate(candidate.start); isBefore(at, end); at = addMinutes(at, 30)) {
    peakExport = Math.max(
      peakExport,
      gridFlowAt([...assignments, candidate], items, constraint, at),
    );
  }
  const reasons = [
    `${bench.id} is compatible with the required ${bench.benchType} recipe.`,
    `${item.serialNumber} has ${item.priority} priority and finishes ${deadlineHours >= 0 ? `${Math.max(1, Math.round(deadlineHours / 24))} day(s) before` : "after"} the customer deadline.`,
    peakExport <= constraint.maxGridExportMW
      ? `The slot keeps expected peak export at ${peakExport.toFixed(1)} MW, below the ${constraint.maxGridExportMW.toFixed(1)} MW cap.`
      : `This is the lowest-scoring available slot, but it still needs review because export may peak at ${peakExport.toFixed(1)} MW.`,
    `It uses available ${format(parseDate(candidate.start), "EEEE HH:mm")} bench capacity without maintenance overlap.`,
  ];
  if (item.expectedPowerProfile.some((point) => point.powerMW < 0)) {
    reasons.push(
      "The import-heavy power profile helps absorb surplus generation from other tests.",
    );
  } else {
    reasons.push("Moving the test later would increase deadline or curtailment risk.");
  }
  return reasons;
}

export function autoSchedule(state: UtiliqState, selectedIds?: string[]) {
  let assignments = state.assignments.map((assignment) => ({
    ...assignment,
    warnings: assignment.warnings?.map((warning) => ({ ...warning })),
    optimizationReason: [...(assignment.optimizationReason ?? [])],
  }));
  let items = state.testItems.map((item) => ({ ...item }));
  const schedulable = items
    .filter(
      (item) =>
        (item.status === "waiting" || item.status === "delayed") &&
        !assignments.some((assignment) => assignment.testItemId === item.id),
    )
    .filter((item) => !selectedIds?.length || selectedIds.includes(item.id))
    .sort((a, b) => {
      const deadlineDelta = parseDate(a.deadline).getTime() - parseDate(b.deadline).getTime();
      return priorityRank[a.priority] - priorityRank[b.priority] || deadlineDelta;
    });

  const created: ScheduleAssignment[] = [];

  for (const item of schedulable) {
    let best: { assignment: ScheduleAssignment; score: number; bench: TestBench } | null = null;
    const compatibleBenches = state.benches.filter((bench) => isBenchCompatible(item, bench));
    for (const bench of compatibleBenches) {
      for (const start of candidateSlotStarts(7, 60)) {
        const end = addMinutes(start, totalTestMinutes(item));
        const candidate: ScheduleAssignment = {
          id: `sa-${item.id}-${bench.id}-${format(start, "MMddHHmm")}`,
          testItemId: item.id,
          benchId: bench.id,
          start: toIsoLocal(start),
          end: toIsoLocal(end),
          locked: false,
          warnings: [],
          optimizationReason: [],
        };
        if (slotHasHardConflict(candidate, assignments, bench)) continue;
        const score = scoreSlot(
          item,
          bench,
          candidate,
          assignments,
          items,
          state.energyConstraint,
          state.optimizationSettings,
        );
        if (!best || score < best.score) best = { assignment: candidate, score, bench };
      }
    }
    if (best) {
      const assignment = {
        ...best.assignment,
        warnings: getAssignmentWarnings(
          best.assignment,
          [...assignments, best.assignment],
          items,
          state.benches,
          state.energyConstraint,
        ),
        optimizationReason: buildExplanation(
          item,
          best.bench,
          best.assignment,
          assignments,
          items,
          state.energyConstraint,
        ),
      };
      assignments = [...assignments, assignment];
      items = items.map((candidate) =>
        candidate.id === item.id
          ? {
              ...candidate,
              status: "scheduled",
              assignedBenchId: assignment.benchId,
              scheduledStart: assignment.start,
              scheduledEnd: assignment.end,
            }
          : candidate,
      );
      created.push(assignment);
    }
  }

  assignments = assignments.map((assignment) => ({
    ...assignment,
    warnings: getAssignmentWarnings(
      assignment,
      assignments,
      items,
      state.benches,
      state.energyConstraint,
    ),
  }));

  return { ...state, testItems: items, assignments, created };
}

export function hydrateAssignmentsOnItems(state: UtiliqState) {
  return {
    ...state,
    testItems: state.testItems.map((item) => {
      const assignment = state.assignments.find((candidate) => candidate.testItemId === item.id);
      if (!assignment) return item;
      return {
        ...item,
        assignedBenchId: assignment.benchId,
        scheduledStart: assignment.start,
        scheduledEnd: assignment.end,
        status: item.status === "waiting" || item.status === "delayed" ? "scheduled" : item.status,
      };
    }),
  };
}

export function calculateImpact(state: UtiliqState) {
  const horizonStart = startOfDay(parseDate(DEMO_NOW));
  const horizonEnd = addDays(horizonStart, 7);
  let peakExport = 0;
  let peakImport = 0;
  let curtailedMWh = 0;
  let generatedMWh = 0;
  let consumedMWh = 0;
  let estimatedSavingsEUR = 0;

  for (let at = horizonStart; isBefore(at, horizonEnd); at = addMinutes(at, 30)) {
    const flow = gridFlowAt(state.assignments, state.testItems, state.energyConstraint, at);
    peakExport = Math.max(peakExport, flow);
    peakImport = Math.max(peakImport, -flow);
    curtailedMWh += Math.max(0, flow - state.energyConstraint.maxGridExportMW) * 0.5;
    if (flow >= 0)
      estimatedSavingsEUR +=
        flow * 0.5 * averagePriceForHour(at.getHours(), state.energyConstraint, true);
    else
      estimatedSavingsEUR -=
        Math.abs(flow) * 0.5 * averagePriceForHour(at.getHours(), state.energyConstraint, false);
  }

  for (const assignment of state.assignments) {
    const item = state.testItems.find((candidate) => candidate.id === assignment.testItemId);
    if (!item) continue;
    const energy = integrateProfileMWh(item);
    generatedMWh += energy.generated;
    consumedMWh += energy.consumed;
  }

  const deadlineViolations = state.assignments.filter((assignment) => {
    const item = state.testItems.find((candidate) => candidate.id === assignment.testItemId);
    return item ? isAfter(parseDate(assignment.end), parseDate(item.deadline)) : false;
  }).length;

  const benchHours = state.benches.length * 7 * 14;
  const scheduledHours = state.assignments.reduce(
    (sum, assignment) => sum + assignmentDurationMinutes(assignment) / 60,
    0,
  );
  const benchUtilization = Math.min(100, Math.round((scheduledHours / benchHours) * 100));
  const scheduleAdherence = state.records.length
    ? Math.round(
        (state.records.filter(
          (record) =>
            record.actualEnd &&
            parseDate(record.actualEnd) <= addMinutes(parseDate(record.scheduledEnd), 30),
        ).length /
          state.records.length) *
          100,
      )
    : 0;

  return {
    peakExport,
    peakImport,
    totalGeneratedMWh: generatedMWh,
    totalConsumedMWh: consumedMWh,
    curtailedMWh,
    estimatedSavingsEUR,
    deadlineViolations,
    benchUtilization,
    scheduleAdherence,
  };
}

export function calculateKpis(state: UtiliqState) {
  const now = parseDate(DEMO_NOW);
  const waiting = state.testItems.filter(
    (item) => item.status === "waiting" || item.status === "delayed",
  ).length;
  const scheduledToday = state.assignments.filter((assignment) =>
    isSameDay(parseDate(assignment.start), now),
  ).length;
  const running = state.testItems.filter((item) => item.status === "running").length;
  const completedThisWeek = state.records.filter(
    (record) =>
      differenceInMinutes(now, parseDate(record.actualEnd ?? record.scheduledEnd)) <= 7 * 24 * 60,
  ).length;
  const deadlineRisks = state.testItems.filter(
    (item) =>
      ["waiting", "scheduled", "running", "delayed"].includes(item.status) &&
      differenceInMinutes(parseDate(item.deadline), now) < 48 * 60,
  ).length;
  const impact = calculateImpact(state);
  const currentGrid = gridFlowAt(state.assignments, state.testItems, state.energyConstraint, now);
  const gridHeadroom =
    currentGrid >= 0
      ? state.energyConstraint.maxGridExportMW - currentGrid
      : state.energyConstraint.maxGridImportMW + currentGrid;
  return {
    waiting,
    scheduledToday,
    running,
    completedThisWeek,
    deadlineRisks,
    benchUtilization: impact.benchUtilization,
    currentGrid,
    gridHeadroom,
    estimatedSavingsEUR: impact.estimatedSavingsEUR,
    curtailedAvoidedMWh: Math.max(0, 14.2 - impact.curtailedMWh),
  };
}

export function createRecordFromAssignment(
  state: UtiliqState,
  assignmentId: string,
  outcome: TestRecord["outcome"] = "pass",
) {
  const assignment = state.assignments.find((candidate) => candidate.id === assignmentId);
  if (!assignment) return state;
  const item = state.testItems.find((candidate) => candidate.id === assignment.testItemId);
  if (!item) return state;
  const energy = integrateProfileMWh(item);
  const gridExported = Math.max(
    0,
    energy.generated -
      energy.consumed -
      state.energyConstraint.facilityBaseLoadMW *
        (assignmentDurationMinutes(assignment) / 60) *
        0.45,
  );
  const curtailed = Math.max(0, gridExported - state.energyConstraint.maxGridExportMW * 0.2);
  const estimatedCostImpactEUR = gridExported * 62 - energy.consumed * 126 - curtailed * 90;
  const now = toIsoLocal(parseDate(DEMO_NOW));
  const record: TestRecord = {
    id: `tr-${item.serialNumber.replace(/[^0-9]/g, "").slice(-5)}-${state.records.length + 1}`,
    testItemId: item.id,
    serialNumber: item.serialNumber,
    modelName: item.modelName,
    benchId: assignment.benchId,
    scheduledStart: assignment.start,
    scheduledEnd: assignment.end,
    actualStart: item.actualStart ?? assignment.start,
    actualEnd: now,
    outcome,
    energyGeneratedMWh: Number(energy.generated.toFixed(1)),
    energyConsumedMWh: Number(energy.consumed.toFixed(1)),
    energyExportedMWh: Number(gridExported.toFixed(1)),
    energyCurtailedMWh: Number(curtailed.toFixed(1)),
    estimatedCostImpactEUR: Math.round(estimatedCostImpactEUR),
    notes: outcome === "pass" ? "Completed from live operations screen." : "Recorded by planner.",
  };
  return {
    ...state,
    records: [record, ...state.records],
    assignments: state.assignments.filter((candidate) => candidate.id !== assignment.id),
    testItems: state.testItems.map((candidate) =>
      candidate.id === item.id
        ? {
            ...candidate,
            status: outcome === "pass" ? "completed" : "failed",
            actualEnd: now,
            testResult: outcome === "pass" ? "pass" : "fail",
          }
        : candidate,
    ),
    benches: state.benches.map((bench) =>
      bench.id === assignment.benchId
        ? { ...bench, status: "available", currentTestItemId: undefined }
        : bench,
    ),
  };
}

export function collectAlerts(state: UtiliqState) {
  const now = parseDate(DEMO_NOW);
  const assignmentWarnings = state.assignments.flatMap((assignment) => {
    const item = state.testItems.find((candidate) => candidate.id === assignment.testItemId);
    return (assignment.warnings ?? []).map((warning) => ({
      severity: warning.severity,
      text: `${item?.serialNumber ?? assignment.id}: ${warning.message}`,
    }));
  });
  const deadlineAlerts = state.testItems
    .filter(
      (item) =>
        ["waiting", "scheduled", "running", "delayed"].includes(item.status) &&
        differenceInMinutes(parseDate(item.deadline), now) < 36 * 60,
    )
    .map((item) => ({
      severity: "warning" as const,
      text: `${item.serialNumber} is at risk of missing its ${formatDateTime(item.deadline)} deadline.`,
    }));
  const impact = calculateImpact(state);
  const gridAlert =
    impact.peakExport > state.energyConstraint.maxGridExportMW
      ? [
          {
            severity: "warning" as const,
            text: `Current schedule peaks at ${impact.peakExport.toFixed(1)} MW export against a ${state.energyConstraint.maxGridExportMW.toFixed(1)} MW cap.`,
          },
        ]
      : [
          {
            severity: "info" as const,
            text: `Optimized schedule keeps peak export at ${impact.peakExport.toFixed(1)} MW.`,
          },
        ];
  return [...deadlineAlerts, ...assignmentWarnings, ...gridAlert].slice(0, 8);
}
