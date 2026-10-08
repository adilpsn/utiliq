import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { toast } from "sonner";
import { createDemoState } from "./utiliq-demo-data";
import {
  autoSchedule,
  createRecordFromAssignment,
  getAssignmentWarnings,
  hydrateAssignmentsOnItems,
  totalTestMinutes,
  toIsoLocal,
} from "./utiliq-engine";
import type {
  BenchStatus,
  EnergyConstraint,
  OptimizationSettings,
  PlantResource,
  ScheduleAssignment,
  TestBench,
  TestItem,
  TestRecord,
  UtiliqState,
} from "./utiliq-types";

const STORAGE_KEY = "utiliq-demo-state-v5";

type Action =
  | { type: "add-item"; item: TestItem }
  | { type: "update-item"; itemId: string; patch: Partial<TestItem> }
  | { type: "delete-item"; itemId: string }
  | { type: "auto-schedule"; itemIds?: string[] }
  | { type: "create-assignment"; assignment: ScheduleAssignment }
  | { type: "lock-assignment"; assignmentId: string; locked: boolean }
  | { type: "remove-assignment"; assignmentId: string }
  | { type: "complete-assignment"; assignmentId: string; outcome?: TestRecord["outcome"] }
  | { type: "add-resource"; resource: PlantResource }
  | { type: "update-resource"; resourceId: string; patch: Partial<PlantResource> }
  | { type: "delete-resource"; resourceId: string }
  | { type: "update-energy"; patch: Partial<EnergyConstraint> }
  | { type: "update-optimization"; patch: OptimizationSettingsPatch }
  | { type: "move-assignment"; assignmentId: string; benchId: string; start: string; end: string }
  | { type: "reset-demo" };

type OptimizationSettingsPatch = {
  preset?: OptimizationSettings["preset"];
  weights?: Partial<OptimizationSettings["weights"]>;
};

type ResourceInput = Omit<PlantResource, "id"> & { id?: string };

const benchStatuses = new Set<BenchStatus>([
  "available",
  "scheduled",
  "running",
  "maintenance",
  "fault",
  "setup",
  "cooldown",
]);

function toBenchStatus(status: string): BenchStatus {
  return benchStatuses.has(status as BenchStatus) ? (status as BenchStatus) : "available";
}

function resourceToBench(resource: PlantResource): TestBench {
  return {
    id: resource.id,
    name: resource.name,
    benchType: resource.benchType ?? "General test bench",
    status: toBenchStatus(resource.status),
    minPowerMW: resource.minPowerMW ?? 0,
    maxPowerMW: resource.maxPowerMW ?? Math.max(1, Math.abs(resource.currentMW)),
    location: resource.location,
    compatibleRecipeIds: resource.compatibleRecipeIds ?? [],
    maintenanceWindows: resource.maintenanceWindows,
  };
}

function nextResourceId(resources: PlantResource[], type: PlantResource["type"]) {
  const prefixByType: Record<PlantResource["type"], string> = {
    "Test Bench": "TB",
    Grid: "GRID",
    Battery: "BAT",
    PV: "PV",
    Generator: "GEN",
    "Load Bank": "LB",
    "Facility Load": "LOAD",
    Cooling: "COOL",
    "Compressed Air": "AIR",
    "Fuel Supply": "FUEL",
  };
  const prefix = prefixByType[type];
  const used = resources
    .map((resource) => resource.id)
    .filter((id) => id.startsWith(`${prefix}-`))
    .map((id) => Number(id.split("-")[1]))
    .filter((value) => Number.isFinite(value));
  const next = Math.max(0, ...used) + 1;
  return `${prefix}-${String(next).padStart(2, "0")}`;
}

function withFreshWarnings(state: UtiliqState): UtiliqState {
  const hydrated = hydrateAssignmentsOnItems(state);
  const assignments = hydrated.assignments.map((assignment) => ({
    ...assignment,
    warnings: getAssignmentWarnings(
      assignment,
      hydrated.assignments,
      hydrated.testItems,
      hydrated.benches,
      hydrated.resources,
      hydrated.energyConstraint,
    ),
  }));
  return hydrateAssignmentsOnItems({ ...hydrated, assignments });
}

function reducer(state: UtiliqState, action: Action): UtiliqState {
  switch (action.type) {
    case "add-item":
      return { ...state, testItems: [action.item, ...state.testItems] };
    case "update-item":
      return withFreshWarnings({
        ...state,
        testItems: state.testItems.map((item) =>
          item.id === action.itemId ? { ...item, ...action.patch } : item,
        ),
      });
    case "delete-item":
      return {
        ...state,
        testItems: state.testItems.filter((item) => item.id !== action.itemId),
        assignments: state.assignments.filter(
          (assignment) => assignment.testItemId !== action.itemId,
        ),
      };
    case "auto-schedule": {
      const next = autoSchedule(state, action.itemIds);
      return withFreshWarnings(next);
    }
    case "create-assignment":
      return withFreshWarnings({
        ...state,
        assignments: [...state.assignments, action.assignment],
        testItems: state.testItems.map((item) =>
          item.id === action.assignment.testItemId
            ? {
                ...item,
                status: "scheduled",
                assignedBenchId: action.assignment.benchId,
                scheduledStart: action.assignment.start,
                scheduledEnd: action.assignment.end,
              }
            : item,
        ),
      });
    case "lock-assignment":
      return {
        ...state,
        assignments: state.assignments.map((assignment) =>
          assignment.id === action.assignmentId
            ? { ...assignment, locked: action.locked }
            : assignment,
        ),
      };
    case "remove-assignment": {
      const assignment = state.assignments.find(
        (candidate) => candidate.id === action.assignmentId,
      );
      return withFreshWarnings({
        ...state,
        assignments: state.assignments.filter((candidate) => candidate.id !== action.assignmentId),
        testItems: state.testItems.map((item) =>
          assignment?.testItemId === item.id
            ? {
                ...item,
                status: item.status === "running" ? "running" : "waiting",
                assignedBenchId: undefined,
                scheduledStart: undefined,
                scheduledEnd: undefined,
              }
            : item,
        ),
      });
    }
    case "complete-assignment":
      return withFreshWarnings(
        createRecordFromAssignment(state, action.assignmentId, action.outcome ?? "pass"),
      );
    case "add-resource": {
      const benches =
        action.resource.type === "Test Bench"
          ? [...state.benches, resourceToBench(action.resource)]
          : state.benches;
      return withFreshWarnings({
        ...state,
        resources: [action.resource, ...state.resources],
        benches,
      });
    }
    case "update-resource": {
      const resources = state.resources.map((resource) =>
        resource.id === action.resourceId ? { ...resource, ...action.patch } : resource,
      );
      const updatedResource = resources.find((resource) => resource.id === action.resourceId);
      const benches =
        updatedResource?.type === "Test Bench"
          ? state.benches.map((bench) =>
              bench.id === action.resourceId ? resourceToBench(updatedResource) : bench,
            )
          : state.benches;
      return withFreshWarnings({ ...state, resources, benches });
    }
    case "delete-resource":
      return withFreshWarnings({
        ...state,
        resources: state.resources.filter((resource) => resource.id !== action.resourceId),
        benches: state.benches.filter((bench) => bench.id !== action.resourceId),
      });
    case "update-energy":
      return withFreshWarnings({
        ...state,
        energyConstraint: { ...state.energyConstraint, ...action.patch },
      });
    case "update-optimization":
      return {
        ...state,
        optimizationSettings: {
          ...state.optimizationSettings,
          ...action.patch,
          weights: { ...state.optimizationSettings.weights, ...action.patch.weights },
        },
      };
    case "move-assignment": {
      const assignment = state.assignments.find((a) => a.id === action.assignmentId);
      if (!assignment || assignment.locked) return state;
      return withFreshWarnings({
        ...state,
        assignments: state.assignments.map((a) =>
          a.id === action.assignmentId
            ? { ...a, benchId: action.benchId, start: action.start, end: action.end }
            : a,
        ),
        testItems: state.testItems.map((item) =>
          item.id === assignment.testItemId
            ? {
                ...item,
                assignedBenchId: action.benchId,
                scheduledStart: action.start,
                scheduledEnd: action.end,
              }
            : item,
        ),
      });
    }
    case "reset-demo":
      return withFreshWarnings(createDemoState());
    default:
      return state;
  }
}

function loadInitialState() {
  if (typeof window === "undefined") return withFreshWarnings(createDemoState());
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return withFreshWarnings(createDemoState());
    return withFreshWarnings(JSON.parse(stored) as UtiliqState);
  } catch {
    return withFreshWarnings(createDemoState());
  }
}

type StoreValue = {
  state: UtiliqState;
  addItem: (
    item: Omit<
      TestItem,
      | "id"
      | "expectedPowerProfile"
      | "estimatedDurationHours"
      | "setupTimeMinutes"
      | "cooldownTimeMinutes"
      | "compatibleBenchIds"
      | "status"
    > & {
      status?: TestItem["status"];
      compatibleBenchIds?: string[];
      estimatedDurationHours?: number;
      setupTimeMinutes?: number;
      cooldownTimeMinutes?: number;
    },
  ) => void;
  updateItem: (itemId: string, patch: Partial<TestItem>) => void;
  deleteItem: (itemId: string) => void;
  autoScheduleItems: (itemIds?: string[]) => void;
  lockAssignment: (assignmentId: string, locked: boolean) => void;
  removeAssignment: (assignmentId: string) => void;
  completeAssignment: (assignmentId: string, outcome?: TestRecord["outcome"]) => void;
  updateEnergyConstraint: (patch: Partial<EnergyConstraint>) => void;
  updateOptimizationSettings: (patch: OptimizationSettingsPatch) => void;
  resetDemoData: () => void;
  createManualAssignment: (itemId: string, benchId: string, start: string) => void;
  addResource: (resource: ResourceInput) => void;
  updateResource: (resourceId: string, patch: Partial<PlantResource>) => void;
  deleteResource: (resourceId: string) => boolean;
  moveAssignment: (assignmentId: string, benchId: string, start: string, end: string) => void;
};

const UtiliqStoreContext = createContext<StoreValue | null>(null);

export function UtiliqStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const value = useMemo<StoreValue>(() => {
    const addItem: StoreValue["addItem"] = (input) => {
      const recipe =
        state.recipes.find((candidate) => candidate.id === input.testRecipeId) ?? state.recipes[0];
      const compatibleBenchIds = input.compatibleBenchIds?.length
        ? input.compatibleBenchIds
        : state.benches
            .filter((bench) => bench.compatibleRecipeIds?.includes(recipe.id))
            .map((bench) => bench.id);
      const item: TestItem = {
        ...input,
        id: `ti-${Date.now()}`,
        status: input.status ?? "waiting",
        compatibleBenchIds,
        estimatedDurationHours: input.estimatedDurationHours ?? recipe.defaultDurationHours,
        setupTimeMinutes: input.setupTimeMinutes ?? recipe.setupTimeMinutes,
        cooldownTimeMinutes: input.cooldownTimeMinutes ?? recipe.cooldownTimeMinutes,
        expectedPowerProfile: recipe.expectedPowerProfile,
      };
      dispatch({ type: "add-item", item });
    };

    const createManualAssignment = (itemId: string, benchId: string, start: string) => {
      const item = state.testItems.find((candidate) => candidate.id === itemId);
      if (!item) return;
      const startDate = new Date(start);
      const assignment: ScheduleAssignment = {
        id: `sa-manual-${item.id}-${Date.now()}`,
        testItemId: item.id,
        benchId,
        start: toIsoLocal(startDate),
        end: toIsoLocal(new Date(startDate.getTime() + totalTestMinutes(item) * 60 * 1000)),
        locked: false,
        warnings: [],
        optimizationReason: [
          "Manual slot selected by planner.",
          "Run optimizer to compare grid and deadline impact.",
        ],
      };
      dispatch({ type: "create-assignment", assignment });
    };

    const addResource = (input: ResourceInput) => {
      const resource: PlantResource = {
        ...input,
        id: input.id?.trim() || nextResourceId(state.resources, input.type),
      };
      dispatch({ type: "add-resource", resource });
    };

    const deleteResource = (resourceId: string) => {
      const hasAssignments = state.assignments.some(
        (assignment) => assignment.benchId === resourceId,
      );
      if (hasAssignments) return false;
      dispatch({ type: "delete-resource", resourceId });
      return true;
    };

    return {
      state,
      addItem,
      updateItem: (itemId, patch) => dispatch({ type: "update-item", itemId, patch }),
      deleteItem: (itemId) => {
        dispatch({ type: "delete-item", itemId });
        toast.info("Test item deleted.");
      },
      autoScheduleItems: (itemIds) => {
        const schedulableCount = (itemIds ?? state.testItems.map((i) => i.id)).filter((id) => {
          const item = state.testItems.find((i) => i.id === id);
          return item && (item.status === "waiting" || item.status === "delayed");
        }).length;
        dispatch({ type: "auto-schedule", itemIds });
        if (schedulableCount > 0) {
          toast.success(
            `Optimizer scheduled ${schedulableCount} item${schedulableCount !== 1 ? "s" : ""}.`,
          );
        } else {
          toast.info("No waiting items to schedule.");
        }
      },
      lockAssignment: (assignmentId, locked) =>
        dispatch({ type: "lock-assignment", assignmentId, locked }),
      removeAssignment: (assignmentId) => {
        dispatch({ type: "remove-assignment", assignmentId });
        toast.info("Assignment removed — item returned to queue.");
      },
      completeAssignment: (assignmentId, outcome) => {
        dispatch({ type: "complete-assignment", assignmentId, outcome });
        toast.success(outcome === "fail" ? "Test recorded as failed." : "Test marked as complete.");
      },
      updateEnergyConstraint: (patch) => dispatch({ type: "update-energy", patch }),
      updateOptimizationSettings: (patch) => dispatch({ type: "update-optimization", patch }),
      resetDemoData: () => {
        dispatch({ type: "reset-demo" });
        toast.info("Demo data reset.");
      },
      createManualAssignment,
      addResource: (input) => {
        addResource(input);
        toast.success("Resource added.");
      },
      updateResource: (resourceId, patch) => {
        dispatch({ type: "update-resource", resourceId, patch });
        toast.success("Resource updated.");
      },
      deleteResource: (resourceId) => {
        const deleted = deleteResource(resourceId);
        if (deleted) toast.info("Resource deleted.");
        else toast.error("Cannot delete — active assignments exist.");
        return deleted;
      },
      moveAssignment: (assignmentId, benchId, start, end) => {
        dispatch({ type: "move-assignment", assignmentId, benchId, start, end });
        toast.success("Assignment moved.");
      },
    };
  }, [state]);

  return <UtiliqStoreContext.Provider value={value}>{children}</UtiliqStoreContext.Provider>;
}

export function useUtiliqStore() {
  const context = useContext(UtiliqStoreContext);
  if (!context) throw new Error("useUtiliqStore must be used inside UtiliqStoreProvider");
  return context;
}
