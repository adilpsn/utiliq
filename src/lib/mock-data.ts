// Mock data for the EMS click-dummy. Swap for real backend later.

export type SourceKind = "generator" | "pv" | "grid" | "battery" | "test-bench";
export type ConsumerKind = "test-bench" | "facility" | "hvac" | "compressor";
export type Status =
  | "running"
  | "idle"
  | "warning"
  | "fault"
  | "stopped"
  | "standby"
  | "charging"
  | "exporting"
  | "importing";

export interface Source {
  id: string;
  name: string;
  kind: SourceKind;
  status: Status;
  powerMW: number;
}

export interface Consumer {
  id: string;
  name: string;
  kind: ConsumerKind;
  status: Status;
  powerMW: number;
  capacityMW: number;
}

export const sources: Source[] = [
  { id: "tb1-src", name: "Test Bench 1", kind: "test-bench", status: "running", powerMW: 2.83 },
  { id: "tb2-src", name: "Test Bench 2", kind: "test-bench", status: "running", powerMW: 1.92 },
  { id: "tb3-src", name: "Test Bench 3", kind: "test-bench", status: "stopped", powerMW: 0 },
  { id: "gen1", name: "Generator", kind: "generator", status: "running", powerMW: 1.74 },
  { id: "pv1", name: "PV System", kind: "pv", status: "running", powerMW: 0.45 },
  { id: "grid-in", name: "Grid Import", kind: "grid", status: "idle", powerMW: 0 },
];

export const consumers: Consumer[] = [
  {
    id: "tb1-con",
    name: "Test Bench 1",
    kind: "test-bench",
    status: "running",
    powerMW: 3.42,
    capacityMW: 5,
  },
  {
    id: "tb2-con",
    name: "Test Bench 2",
    kind: "test-bench",
    status: "running",
    powerMW: 2.82,
    capacityMW: 4,
  },
  {
    id: "fac",
    name: "Facility Load",
    kind: "facility",
    status: "running",
    powerMW: 1.12,
    capacityMW: 2,
  },
  {
    id: "hvac",
    name: "HVAC System",
    kind: "hvac",
    status: "running",
    powerMW: 0.68,
    capacityMW: 1.2,
  },
  {
    id: "comp",
    name: "Compressed Air",
    kind: "compressor",
    status: "standby",
    powerMW: 0.42,
    capacityMW: 0.8,
  },
];

export const powerBus = {
  productionMW: 8.71,
  loadMW: 7.34,
  netExportMW: 1.37,
  frequencyHz: 50.0,
  voltageKV: 11.2,
};

export const grid = {
  status: "Connected",
  flowMW: 1.37,
  direction: "export" as const,
  voltageKV: 11.2,
};
export const battery = { powerMW: 1.25, soc: 78, status: "charging" as const };

export interface ForecastPoint {
  time: string; // "HH:00"
  forecast: number;
  actual: number | null;
}
export const forecast: ForecastPoint[] = Array.from({ length: 25 }, (_, h) => {
  const fc = Math.round((4 + 8 * Math.sin((h / 24) * Math.PI) + h * 1.2) * 10) / 10;
  const actual = h <= 13 ? Math.round((fc - 4 + Math.sin(h) * 2) * 10) / 10 : null;
  return {
    time: `${String(h).padStart(2, "0")}:00`,
    forecast: Math.max(0, fc),
    actual: actual === null ? null : Math.max(0, actual),
  };
});
export const forecastTotalMWh = 156.8;

export interface EventEntry {
  time: string;
  severity: "info" | "ok" | "warning" | "fault";
  text: string;
}
export const recentEvents: EventEntry[] = [
  { time: "13:19", severity: "ok", text: "Generator started" },
  { time: "13:11", severity: "info", text: "Test Bench TB02 started" },
  { time: "12:58", severity: "warning", text: "Grid export limit reached" },
  { time: "12:45", severity: "info", text: "Battery charging" },
  { time: "12:33", severity: "info", text: "HVAC system active" },
  { time: "11:50", severity: "ok", text: "PV System nominal" },
];

export const systemStatus = {
  grid: "Connected",
  battery: "Charging",
  alarms: 0,
  warnings: 2,
};

// ---------- Assets ----------
export interface Asset {
  id: string;
  name: string;
  type: "Generator" | "Test Bench" | "Battery" | "Grid" | "PV" | "Consumer";
  status: Status;
  currentMW: number;
  capacityMW: number;
  location: string;
}
export const assets: Asset[] = [
  {
    id: "GEN-01",
    name: "Generator",
    type: "Generator",
    status: "running",
    currentMW: 1.74,
    capacityMW: 3.0,
    location: "Hall A — Bay 1",
  },
  {
    id: "TB-01",
    name: "Test Bench TB01",
    type: "Test Bench",
    status: "running",
    currentMW: 3.42,
    capacityMW: 5.0,
    location: "Hall B — Bay 1",
  },
  {
    id: "TB-02",
    name: "Test Bench TB02",
    type: "Test Bench",
    status: "running",
    currentMW: 2.82,
    capacityMW: 4.0,
    location: "Hall B — Bay 2",
  },
  {
    id: "TB-03",
    name: "Test Bench TB03",
    type: "Test Bench",
    status: "stopped",
    currentMW: 0,
    capacityMW: 6.0,
    location: "Hall B — Bay 3",
  },
  {
    id: "TB-04",
    name: "Test Bench TB04",
    type: "Test Bench",
    status: "idle",
    currentMW: 0,
    capacityMW: 4.0,
    location: "Hall C — Bay 1",
  },
  {
    id: "BAT-01",
    name: "Battery System",
    type: "Battery",
    status: "charging",
    currentMW: 1.25,
    capacityMW: 2.0,
    location: "Hall A — Bay 4",
  },
  {
    id: "GRID-01",
    name: "Grid Connection",
    type: "Grid",
    status: "exporting",
    currentMW: 1.37,
    capacityMW: 5.0,
    location: "Substation",
  },
  {
    id: "PV-01",
    name: "PV System",
    type: "PV",
    status: "running",
    currentMW: 0.45,
    capacityMW: 1.0,
    location: "Roof — North",
  },
  {
    id: "HVAC-01",
    name: "HVAC System",
    type: "Consumer",
    status: "running",
    currentMW: 0.68,
    capacityMW: 1.2,
    location: "Facility",
  },
];

// ---------- Schedule ----------
export const benchIds = ["TB-01", "TB-02", "TB-03", "TB-04"];
export const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface Booking {
  id: string;
  benchId: string;
  day: number; // 0-6
  startHour: number; // 0-23
  durationH: number;
  product: string;
  serial: string;
  customer: string;
  status: "scheduled" | "running" | "done" | "fault";
}
export const bookings: Booking[] = [
  {
    id: "B-1001",
    benchId: "TB-01",
    day: 0,
    startHour: 7,
    durationH: 4,
    product: "D13 Diesel Engine",
    serial: "D13-22481",
    customer: "Liebherr",
    status: "done",
  },
  {
    id: "B-1002",
    benchId: "TB-01",
    day: 0,
    startHour: 13,
    durationH: 5,
    product: "Hydraulic Pump HP-450",
    serial: "HP-90211",
    customer: "Komatsu",
    status: "running",
  },
  {
    id: "B-1003",
    benchId: "TB-02",
    day: 0,
    startHour: 8,
    durationH: 6,
    product: "Gearbox GX-9",
    serial: "GX9-3320",
    customer: "CAT",
    status: "running",
  },
  {
    id: "B-1004",
    benchId: "TB-03",
    day: 1,
    startHour: 9,
    durationH: 4,
    product: "D16 Diesel Engine",
    serial: "D16-77104",
    customer: "Volvo CE",
    status: "scheduled",
  },
  {
    id: "B-1005",
    benchId: "TB-02",
    day: 1,
    startHour: 14,
    durationH: 3,
    product: "Hydraulic Pump HP-300",
    serial: "HP-90308",
    customer: "Liebherr",
    status: "scheduled",
  },
  {
    id: "B-1006",
    benchId: "TB-04",
    day: 2,
    startHour: 7,
    durationH: 8,
    product: "Powertrain PT-2",
    serial: "PT2-1140",
    customer: "JCB",
    status: "scheduled",
  },
  {
    id: "B-1007",
    benchId: "TB-01",
    day: 2,
    startHour: 9,
    durationH: 4,
    product: "D11 Diesel Engine",
    serial: "D11-66031",
    customer: "CAT",
    status: "scheduled",
  },
  {
    id: "B-1008",
    benchId: "TB-03",
    day: 3,
    startHour: 8,
    durationH: 6,
    product: "Final Drive FD-7",
    serial: "FD7-2204",
    customer: "Komatsu",
    status: "scheduled",
  },
  {
    id: "B-1009",
    benchId: "TB-02",
    day: 3,
    startHour: 15,
    durationH: 3,
    product: "Cooling Module CM-3",
    serial: "CM3-5519",
    customer: "Liebherr",
    status: "scheduled",
  },
  {
    id: "B-1010",
    benchId: "TB-04",
    day: 4,
    startHour: 8,
    durationH: 5,
    product: "Axle AX-4",
    serial: "AX4-7700",
    customer: "Volvo CE",
    status: "scheduled",
  },
  {
    id: "B-1011",
    benchId: "TB-01",
    day: 4,
    startHour: 14,
    durationH: 3,
    product: "Hydraulic Pump HP-500",
    serial: "HP-91402",
    customer: "JCB",
    status: "scheduled",
  },
];

// ---------- History ----------
export interface HistoryRecord {
  id: string;
  date: string; // ISO
  benchId: string;
  product: string;
  serial: string;
  customer: string;
  durationH: number;
  outcome: "pass" | "fail" | "aborted";
  onSchedule: boolean;
}
export const history: HistoryRecord[] = [
  {
    id: "H-9912",
    date: "2024-05-21",
    benchId: "TB-01",
    product: "D13 Diesel Engine",
    serial: "D13-22481",
    customer: "Liebherr",
    durationH: 4,
    outcome: "pass",
    onSchedule: true,
  },
  {
    id: "H-9911",
    date: "2024-05-21",
    benchId: "TB-02",
    product: "Gearbox GX-8",
    serial: "GX8-3201",
    customer: "CAT",
    durationH: 6,
    outcome: "pass",
    onSchedule: true,
  },
  {
    id: "H-9910",
    date: "2024-05-20",
    benchId: "TB-03",
    product: "Final Drive FD-6",
    serial: "FD6-2113",
    customer: "Komatsu",
    durationH: 5,
    outcome: "fail",
    onSchedule: false,
  },
  {
    id: "H-9909",
    date: "2024-05-20",
    benchId: "TB-01",
    product: "Hydraulic Pump HP-450",
    serial: "HP-90188",
    customer: "JCB",
    durationH: 3,
    outcome: "pass",
    onSchedule: true,
  },
  {
    id: "H-9908",
    date: "2024-05-19",
    benchId: "TB-04",
    product: "Powertrain PT-1",
    serial: "PT1-1098",
    customer: "Volvo CE",
    durationH: 8,
    outcome: "aborted",
    onSchedule: false,
  },
  {
    id: "H-9907",
    date: "2024-05-19",
    benchId: "TB-02",
    product: "Cooling Module CM-2",
    serial: "CM2-5402",
    customer: "Liebherr",
    durationH: 3,
    outcome: "pass",
    onSchedule: true,
  },
  {
    id: "H-9906",
    date: "2024-05-18",
    benchId: "TB-01",
    product: "D16 Diesel Engine",
    serial: "D16-77001",
    customer: "CAT",
    durationH: 5,
    outcome: "pass",
    onSchedule: true,
  },
  {
    id: "H-9905",
    date: "2024-05-18",
    benchId: "TB-03",
    product: "Axle AX-3",
    serial: "AX3-7611",
    customer: "Komatsu",
    durationH: 4,
    outcome: "fail",
    onSchedule: true,
  },
  {
    id: "H-9904",
    date: "2024-05-17",
    benchId: "TB-04",
    product: "Gearbox GX-7",
    serial: "GX7-3140",
    customer: "JCB",
    durationH: 6,
    outcome: "pass",
    onSchedule: true,
  },
  {
    id: "H-9903",
    date: "2024-05-17",
    benchId: "TB-02",
    product: "Hydraulic Pump HP-400",
    serial: "HP-90021",
    customer: "Volvo CE",
    durationH: 3,
    outcome: "pass",
    onSchedule: true,
  },
];
