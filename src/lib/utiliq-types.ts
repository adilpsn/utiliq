export type Priority = "low" | "normal" | "high" | "urgent";
export type TestItemStatus =
  | "waiting"
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "delayed";
export type TestResult = "pass" | "fail" | "pending";
export type BenchStatus =
  | "available"
  | "scheduled"
  | "running"
  | "maintenance"
  | "fault"
  | "setup"
  | "cooldown";

export type PowerProfilePoint = {
  offsetMinutes: number;
  powerMW: number;
};

export type TestItem = {
  id: string;
  serialNumber: string;
  modelNumber: string;
  modelName: string;
  customerName?: string;
  orderId?: string;
  dateManufactured: string;
  readyForTestDate: string;
  deadline: string;
  priority: Priority;
  status: TestItemStatus;
  testRecipeId: string;
  compatibleBenchIds: string[];
  estimatedDurationHours: number;
  setupTimeMinutes: number;
  cooldownTimeMinutes: number;
  expectedPowerProfile: PowerProfilePoint[];
  assignedBenchId?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  testResult?: TestResult;
  notes?: string;
};

export type TestRecipe = {
  id: string;
  name: string;
  description: string;
  defaultDurationHours: number;
  requiredBenchType: string;
  setupTimeMinutes: number;
  cooldownTimeMinutes: number;
  expectedPowerProfile: PowerProfilePoint[];
  requiredOperatorSkill?: string;
};

export type MaintenanceWindow = {
  id: string;
  start: string;
  end: string;
  reason: string;
};

export type TestBench = {
  id: string;
  name: string;
  benchType: string;
  status: BenchStatus;
  minPowerMW?: number;
  maxPowerMW: number;
  location: string;
  compatibleRecipeIds?: string[];
  currentTestItemId?: string;
  maintenanceWindows?: MaintenanceWindow[];
};

export type PricePoint = {
  time: string;
  eurPerMWh: number;
};

export type EnergyConstraint = {
  maxGridImportMW: number;
  maxGridExportMW: number;
  batteryCapacityMWh?: number;
  batteryStateOfChargePercent?: number;
  facilityBaseLoadMW: number;
  electricityPriceProfile?: PricePoint[];
  feedInTariffProfile?: PricePoint[];
};

export type ScheduleWarningType =
  | "grid_export_cap_exceeded"
  | "grid_import_cap_exceeded"
  | "deadline_risk"
  | "incompatible_bench"
  | "overlapping_tests"
  | "maintenance_conflict"
  | "high_curtailment_risk"
  | "low_battery_headroom";

export type ScheduleWarning = {
  type: ScheduleWarningType;
  severity: "info" | "warning" | "critical";
  message: string;
};

export type ScheduleAssignment = {
  id: string;
  testItemId: string;
  benchId: string;
  start: string;
  end: string;
  locked?: boolean;
  warnings?: ScheduleWarning[];
  optimizationReason?: string[];
};

export type TestRecord = {
  id: string;
  testItemId: string;
  serialNumber: string;
  modelName: string;
  benchId: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart?: string;
  actualEnd?: string;
  outcome: "pass" | "fail" | "aborted";
  energyGeneratedMWh?: number;
  energyConsumedMWh?: number;
  energyExportedMWh?: number;
  energyCurtailedMWh?: number;
  estimatedCostImpactEUR?: number;
  notes?: string;
};

export type OptimizationPreset =
  | "balanced"
  | "deadline-first"
  | "cost-optimized"
  | "grid-safe"
  | "throughput";

export type OptimizationSettings = {
  preset: OptimizationPreset;
  weights: {
    meetDeadlines: number;
    reduceEnergyCost: number;
    avoidGridCaps: number;
    maximizeUtilization: number;
    reduceOvertime: number;
    minimizeCurtailment: number;
  };
};

export type PlantResource = {
  id: string;
  name: string;
  type:
    | "Test Bench"
    | "Grid"
    | "Battery"
    | "PV"
    | "Generator"
    | "Load Bank"
    | "Facility Load"
    | "Cooling"
    | "Compressed Air"
    | "Fuel Supply";
  status: string;
  location: string;
  currentMW: number;
  notes?: string;
  benchType?: string;
  minPowerMW?: number;
  maxPowerMW?: number;
  compatibleRecipeIds?: string[];
  maxGenerationMW?: number;
  currentGenerationMW?: number;
  maxConsumptionMW?: number;
  currentConsumptionMW?: number;
  batteryCapacityMWh?: number;
  maxChargeDischargeMW?: number;
  batteryStateOfChargePercent?: number;
  maxGridImportMW?: number;
  maxGridExportMW?: number;
  compatibleTestTypes?: string[];
  maintenanceWindows?: MaintenanceWindow[];
  utilizationPercent?: number;
};

export type UtiliqState = {
  testItems: TestItem[];
  recipes: TestRecipe[];
  benches: TestBench[];
  assignments: ScheduleAssignment[];
  records: TestRecord[];
  energyConstraint: EnergyConstraint;
  optimizationSettings: OptimizationSettings;
  resources: PlantResource[];
};
