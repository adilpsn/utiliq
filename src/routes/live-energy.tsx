import { createFileRoute } from "@tanstack/react-router";
import { differenceInMinutes, isAfter, isBefore } from "date-fns";
import type React from "react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Battery, Cable, Factory, Gauge, Pencil, RadioTower, Zap } from "lucide-react";
import { Panel } from "@/components/ems/Panel";
import { ResourceDialog } from "@/components/ems/ResourceDialog";
import { StatusDot, StatusLabel } from "@/components/ems/StatusDot";
import { Button } from "@/components/ui/button";
import { useUtiliqStore } from "@/lib/utiliq-store";
import { DEMO_NOW } from "@/lib/utiliq-demo-data";
import {
  buildEnergyForecast,
  formatTime,
  parseDate,
  powerForAssignmentAt,
} from "@/lib/utiliq-engine";
import type { PlantResource, ScheduleAssignment, TestItem } from "@/lib/utiliq-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/live-energy")({
  head: () => ({
    meta: [
      { title: "Live Energy - Utiliq" },
      {
        name: "description",
        content:
          "Live energy and test operations connected to active and inactive plant resources.",
      },
    ],
  }),
  component: LiveEnergyPage,
});

type OperationResource = PlantResource & {
  displayMW: number;
  active: boolean;
  assignment?: ScheduleAssignment;
  item?: TestItem;
  progress?: number;
};

function LiveEnergyPage() {
  const { state, completeAssignment, updateResource } = useUtiliqStore();
  const [editingResource, setEditingResource] = useState<PlantResource | null>(null);
  const now = parseDate(DEMO_NOW);
  const forecast = useMemo(() => buildEnergyForecast(state), [state]);

  const operationsWithoutGrid = state.resources
    .filter((resource) => resource.type !== "Grid")
    .map((resource): OperationResource => {
      if (resource.type === "Battery") {
        const rawPower = resource.currentMW ?? 0;
        const displayMW =
          resource.status === "charging"
            ? -Math.abs(rawPower)
            : resource.status === "discharging"
              ? Math.abs(rawPower)
              : rawPower;
        return {
          ...resource,
          currentMW: displayMW,
          displayMW,
          active: Math.abs(displayMW) > 0.05,
          status: displayMW >= 0 ? "discharging" : "charging",
        };
      }
      if (resource.type !== "Test Bench")
        return {
          ...resource,
          displayMW: resource.currentMW,
          active:
            Math.abs(resource.currentMW) > 0.05 &&
            !["standby", "available", "inactive"].includes(resource.status),
        };

      const assignment = state.assignments.find(
        (candidate) =>
          candidate.benchId === resource.id &&
          isAfter(now, parseDate(candidate.start)) &&
          isBefore(now, parseDate(candidate.end)),
      );
      const item = assignment
        ? state.testItems.find((candidate) => candidate.id === assignment.testItemId)
        : undefined;
      const displayMW = assignment ? powerForAssignmentAt(assignment, item, now) : 0;
      const progress = assignment
        ? Math.max(
            0,
            Math.min(
              100,
              Math.round(
                (differenceInMinutes(now, parseDate(assignment.start)) /
                  differenceInMinutes(parseDate(assignment.end), parseDate(assignment.start))) *
                  100,
              ),
            ),
          )
        : undefined;
      return {
        ...resource,
        displayMW,
        active: Boolean(assignment),
        assignment,
        item,
        progress,
        status: assignment ? "running" : resource.status || "available",
      };
    });

  const facilityBase: OperationResource = {
    id: "FAC-BASE",
    name: "Facility base load",
    type: "Facility Load",
    status: "running",
    location: "Plant-wide",
    currentMW: -state.energyConstraint.facilityBaseLoadMW,
    displayMW: -state.energyConstraint.facilityBaseLoadMW,
    active: true,
  };
  const nonGridNetPower = operationsWithoutGrid.reduce(
    (sum, resource) => sum + resource.displayMW,
    facilityBase.displayMW,
  );
  const currentGrid = nonGridNetPower;

  const operations = state.resources.map((resource): OperationResource => {
    if (resource.type === "Grid")
      return {
        ...resource,
        currentMW: currentGrid,
        displayMW: currentGrid,
        active: Math.abs(currentGrid) > 0.05,
        status: currentGrid >= 0 ? "exporting" : "importing",
      };
    const hydrated = operationsWithoutGrid.find((candidate) => candidate.id === resource.id);
    if (hydrated) return hydrated;
    if (resource.type !== "Test Bench")
      return {
        ...resource,
        displayMW: resource.currentMW,
        active:
          Math.abs(resource.currentMW) > 0.05 &&
          !["standby", "available", "inactive"].includes(resource.status),
      };

    const assignment = state.assignments.find(
      (candidate) =>
        candidate.benchId === resource.id &&
        isAfter(now, parseDate(candidate.start)) &&
        isBefore(now, parseDate(candidate.end)),
    );
    const item = assignment
      ? state.testItems.find((candidate) => candidate.id === assignment.testItemId)
      : undefined;
    const displayMW = assignment ? powerForAssignmentAt(assignment, item, now) : 0;
    const progress = assignment
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(
              (differenceInMinutes(now, parseDate(assignment.start)) /
                differenceInMinutes(parseDate(assignment.end), parseDate(assignment.start))) *
                100,
            ),
          ),
        )
      : undefined;
    return {
      ...resource,
      displayMW,
      active: Boolean(assignment),
      assignment,
      item,
      progress,
      status: assignment ? "running" : resource.status || "available",
    };
  });

  const gridResource = operations.find((resource) => resource.type === "Grid");
  const batteryResource = operations.find((resource) => resource.type === "Battery");
  const batteryPower = batteryResource?.displayMW ?? 0;
  const sourceItems = operations.filter(
    (resource) => resource.type !== "Grid" && resource.type !== "Battery" && resource.displayMW > 0,
  );
  const inactiveSources = operations.filter(
    (resource) =>
      resource.type !== "Grid" &&
      resource.type !== "Battery" &&
      resource.displayMW === 0 &&
      isSourceCapable(resource),
  );
  const consumerItems = operations.filter(
    (resource) => resource.type !== "Grid" && resource.type !== "Battery" && resource.displayMW < 0,
  );
  const inactiveConsumers = operations.filter(
    (resource) =>
      resource.type !== "Grid" &&
      resource.type !== "Battery" &&
      resource.displayMW === 0 &&
      !isSourceCapable(resource),
  );
  const sources = [...sourceItems, ...inactiveSources];
  const consumers = [...consumerItems, facilityBase, ...inactiveConsumers];
  const sourcePower =
    sourceItems.reduce((sum, resource) => sum + resource.displayMW, 0) +
    Math.max(0, -currentGrid) +
    Math.max(0, batteryPower);
  const consumerPower =
    Math.abs(consumerItems.reduce((sum, resource) => sum + resource.displayMW, 0)) +
    state.energyConstraint.facilityBaseLoadMW +
    Math.max(0, currentGrid) +
    Math.max(0, -batteryPower);
  const busPower = Math.max(sourcePower, consumerPower);

  const events = [
    ...operations
      .filter((resource) => resource.assignment && resource.item)
      .map((resource) => ({
        severity: "ok" as const,
        text: `${resource.item!.serialNumber} running on ${resource.id}; ${Math.abs(resource.displayMW).toFixed(1)} MW ${resource.displayMW >= 0 ? "generation" : "import"}.`,
      })),
    ...(operations.some(
      (resource) => resource.type === "Test Bench" && (resource.minPowerMW ?? 0) < 0,
    )
      ? [
          {
            severity: "info" as const,
            text: "Consuming test benches support negative MW operating ranges.",
          },
        ]
      : []),
    {
      severity: "info" as const,
      text: operations.some((resource) => resource.type === "Test Bench" && !resource.active)
        ? "Inactive test bench capacity is visible for schedule planning."
        : "All configured test benches have active work.",
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <Panel contentClassName="flex flex-wrap items-center gap-3 p-3">
        <div className="px-2">
          <h1 className="text-sm font-semibold uppercase tracking-[0.14em]">Live Energy</h1>
          <p className="text-[11px] text-muted-foreground">
            Operations snapshot · {DEMO_NOW.replace("T", " ").slice(0, 16)}
          </p>
        </div>
        <div className="ml-auto grid grid-cols-3 gap-5 text-right">
          <TopMetric
            label="Grid flow"
            value={`${Math.abs(currentGrid).toFixed(1)} MW`}
            sub={currentGrid >= 0 ? "export" : "import"}
            warn={Math.abs(currentGrid) > state.energyConstraint.maxGridExportMW * 0.9}
          />
          <TopMetric
            label={currentGrid >= 0 ? "Export headroom" : "Import headroom"}
            value={`${(currentGrid >= 0 ? state.energyConstraint.maxGridExportMW - currentGrid : state.energyConstraint.maxGridImportMW + currentGrid).toFixed(1)} MW`}
            sub="grid cap margin"
          />
          <TopMetric
            label="Resources"
            value={`${operations.filter((resource) => resource.active).length}/${operations.length}`}
            sub="active"
          />
        </div>
      </Panel>

      <Panel title="Energy Flow & Routing" contentClassName="p-3">
        <div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(230px,0.9fr)_minmax(320px,1.25fr)_minmax(230px,0.9fr)]">
            <FlowColumn title="Sources">
              {sources.map((resource) => (
                <FlowCard
                  key={resource.id}
                  resource={resource}
                  side="source"
                  onComplete={() =>
                    resource.assignment && completeAssignment(resource.assignment.id, "pass")
                  }
                  onEdit={
                    resource.id !== "FAC-BASE"
                      ? () => {
                          const src = state.resources.find((r) => r.id === resource.id);
                          if (src) setEditingResource(src);
                        }
                      : undefined
                  }
                />
              ))}
            </FlowColumn>

            <PowerBusDiagram
              sourcePower={sourcePower}
              consumerPower={consumerPower}
              busPower={busPower}
              gridResource={gridResource}
              gridPower={currentGrid}
              batteryResource={batteryResource}
              batteryPower={batteryPower}
            />

            <FlowColumn title="Consumers">
              {consumers.map((resource) => (
                <FlowCard
                  key={resource.id}
                  resource={resource}
                  side="consumer"
                  onComplete={() =>
                    resource.assignment && completeAssignment(resource.assignment.id, "pass")
                  }
                  onEdit={
                    resource.id !== "FAC-BASE"
                      ? () => {
                          const src = state.resources.find((r) => r.id === resource.id);
                          if (src) setEditingResource(src);
                        }
                      : undefined
                  }
                />
              ))}
            </FlowColumn>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-12 gap-3">
        <Panel title="Grid Forecast" className="col-span-12 lg:col-span-8">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={forecast}>
                <CartesianGrid
                  strokeDasharray="2 4"
                  stroke="var(--color-grid-line)"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  interval={2}
                />
                <YAxis tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} width={36} />
                <RTooltip
                  contentStyle={{
                    background: "var(--color-panel)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 2,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="gridMW"
                  stroke="var(--color-primary)"
                  fill="var(--color-primary)"
                  fillOpacity={0.12}
                />
                <Line
                  type="monotone"
                  dataKey="exportCap"
                  stroke="var(--color-warning)"
                  strokeDasharray="4 3"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="importCap"
                  stroke="var(--color-fault)"
                  strokeDasharray="4 3"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Event Log" className="col-span-12 lg:col-span-4">
          <ul className="space-y-2.5 text-xs">
            {events.map((event, index) => (
              <li key={`${event.text}-${index}`} className="flex items-start gap-2.5">
                <span className="font-mono text-muted-foreground">{formatTime(DEMO_NOW)}</span>
                <StatusDot
                  status={
                    event.severity === "warning"
                      ? "warning"
                      : event.severity === "ok"
                        ? "running"
                        : "idle"
                  }
                  className="mt-1.5"
                />
                <span className="flex-1">{event.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <ResourceDialog
        open={!!editingResource}
        onOpenChange={(open) => !open && setEditingResource(null)}
        resource={editingResource}
        onSubmit={(patch) => {
          if (editingResource) updateResource(editingResource.id, patch);
          setEditingResource(null);
        }}
      />
    </div>
  );
}

function isSourceCapable(resource: OperationResource) {
  if (resource.type === "PV" || resource.type === "Generator") return true;
  if (resource.type === "Test Bench") return (resource.maxPowerMW ?? 0) > 0;
  return false;
}

function FlowColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-border bg-panel">
      <div className="border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </div>
      <div className="space-y-2 p-2">{children}</div>
    </div>
  );
}

function FlowCard({
  resource,
  side,
  onComplete,
  onEdit,
}: {
  resource: OperationResource;
  side: "source" | "consumer";
  onComplete: () => void;
  onEdit?: () => void;
}) {
  const Icon = resourceIcon(resource.type);
  const active = Math.abs(resource.displayMW) > 0.05;
  const color =
    resource.displayMW > 0
      ? "text-production"
      : resource.displayMW < 0
        ? "text-consumption"
        : "text-muted-foreground";
  const content = (
    <div
      className={cn(
        "group rounded-sm border border-border bg-card p-3 shadow-[var(--elevate-1)] border-l-[3px] border-l-border transition-colors",
        active && side === "source" && "border-production/45 border-l-production",
        active && side === "consumer" && "border-consumption/45 border-l-consumption",
        resource.type === "Test Bench" && "hover:bg-accent/30",
      )}
    >
      <div className="flex items-center gap-3">
        <StatusDot status={active ? (side === "consumer" ? "importing" : "running") : resource.status} />
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-sm bg-muted text-muted-foreground",
            active && side === "source" && "bg-production/15 text-production",
            active && side === "consumer" && "bg-consumption/15 text-consumption",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{resource.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {resource.type}
            {resource.type === "Test Bench" && resource.minPowerMW !== undefined
              ? ` · ${resource.minPowerMW} to ${resource.maxPowerMW} MW`
              : ""}
          </div>
        </div>
        <div className={cn("font-mono text-sm font-semibold", color)}>
          {resource.displayMW > 0 ? "+" : ""}
          {resource.displayMW.toFixed(2)}{" "}
          <span className="text-[10px] text-muted-foreground">MW</span>
        </div>
        {onEdit && (
          <button
            onClick={(e) => {
              e.preventDefault();
              onEdit();
            }}
            className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground/60 hover:text-foreground"
            title="Edit resource"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {resource.item && resource.assignment ? (
        <div className="mt-3 border-t border-border pt-2">
          <div className="font-mono text-xs text-primary">{resource.item.serialNumber}</div>
          <div className="text-xs text-muted-foreground">{resource.item.modelName}</div>
          <div className="mt-2 h-1.5 rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary"
              style={{ width: `${resource.progress ?? 0}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{resource.progress}% complete</span>
            <span>Ends {formatTime(resource.assignment.end)}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full"
            onClick={(event) => {
              event.preventDefault();
              onComplete();
            }}
          >
            Mark completed
          </Button>
        </div>
      ) : resource.type === "Test Bench" ? (
        <div className="mt-2 text-xs text-muted-foreground">
          Inactive. Click to open schedule for this bench.
        </div>
      ) : (
        <StatusLabel status={resource.status} />
      )}
    </div>
  );
  if (resource.type === "Test Bench")
    return <a href={`/schedule?bench=${encodeURIComponent(resource.id)}`}>{content}</a>;
  return content;
}

function PowerBusDiagram({
  sourcePower,
  consumerPower,
  busPower,
  gridResource,
  gridPower,
  batteryResource,
  batteryPower,
}: {
  sourcePower: number;
  consumerPower: number;
  busPower: number;
  gridResource?: OperationResource;
  gridPower: number;
  batteryResource?: OperationResource;
  batteryPower: number;
}) {
  return (
    <div className="relative min-h-[430px] overflow-hidden rounded-sm border border-border bg-background/30 p-4">
      <div className="absolute inset-4 rounded-sm bg-[radial-gradient(circle_at_center,rgba(0,136,255,0.10),transparent_42%)]" />

      <CenterNode
        className="absolute left-1/2 top-5 w-[min(68%,280px)] -translate-x-1/2"
        resource={gridResource}
        icon={Cable}
        value={gridPower}
        label={gridPower >= 0 ? "Exporting" : "Importing"}
      />
      <CenterNode
        className="absolute bottom-5 left-1/2 w-[min(68%,280px)] -translate-x-1/2"
        resource={batteryResource}
        icon={Battery}
        value={batteryPower}
        label={batteryPower >= 0 ? "Discharging" : "Charging"}
      />
      <HorizontalConnector side="left" tone="source" />
      <HorizontalConnector side="right" tone="consumer" />
      <VerticalConnector
        top="116px"
        bottom="calc(50% + 88px)"
        tone={gridPower < 0 ? "source" : "consumer"}
        direction={gridPower >= 0 ? "up" : "down"}
      />
      <VerticalConnector
        top="calc(50% + 88px)"
        bottom="116px"
        tone={batteryPower > 0 ? "source" : "consumer"}
        direction={batteryPower > 0 ? "up" : "down"}
      />

      <div className="absolute left-1/2 top-1/2 z-10 flex h-40 w-[min(54%,260px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-sm border border-primary/80 bg-primary/10 shadow-[0_0_28px_rgba(0,136,255,0.16)]">
        <RadioTower className="mb-3 h-8 w-8 text-primary" />
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Power Bus
        </div>
        <div className="mt-2 font-mono text-4xl font-semibold">
          {busPower.toFixed(2)} <span className="text-base text-muted-foreground">MW</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-3 text-center text-xs text-muted-foreground">
          <span>
            <b className="font-mono text-production">{sourcePower.toFixed(1)}</b> MW in
          </span>
          <span>
            <b className="font-mono text-consumption">{consumerPower.toFixed(1)}</b> MW out
          </span>
        </div>
      </div>
    </div>
  );
}

function CenterNode({
  resource,
  icon: Icon,
  value,
  label,
  className,
}: {
  resource?: OperationResource;
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "z-10 flex items-center gap-3 rounded-sm border border-border bg-panel/95 px-4 py-3 shadow-sm",
        className,
      )}
    >
      <Icon className="h-8 w-8 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {resource?.name ?? "Resource"}
        </div>
        <div
          className={cn(
            "font-mono text-xl font-semibold",
            value > 0 ? "text-production" : value < 0 ? "text-consumption" : "text-muted-foreground",
          )}
        >
          {value > 0 ? "+" : ""}
          {value.toFixed(2)} <span className="text-xs text-muted-foreground">MW</span>
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}

function VerticalConnector({
  top,
  bottom,
  tone,
  direction,
}: {
  top: string;
  bottom: string;
  tone: "source" | "consumer";
  direction: "up" | "down";
}) {
  const color = tone === "source" ? "bg-production/80" : "bg-consumption/80";
  const arrowColor =
    tone === "source"
      ? "border-b-production border-t-production"
      : "border-b-consumption border-t-consumption";
  return (
    <div
      className={cn("absolute left-1/2 z-0 w-px -translate-x-1/2", color)}
      style={{ top, bottom }}
    >
      {direction === "down" ? (
        <span
          className={cn(
            "absolute bottom-[-1px] left-1/2 h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[8px] border-x-transparent",
            arrowColor,
          )}
        />
      ) : (
        <span
          className={cn(
            "absolute left-1/2 top-[-1px] h-0 w-0 -translate-x-1/2 border-x-[5px] border-b-[8px] border-x-transparent",
            arrowColor,
          )}
        />
      )}
    </div>
  );
}

function HorizontalConnector({
  side,
  tone,
}: {
  side: "left" | "right";
  tone: "source" | "consumer";
}) {
  const line = tone === "source" ? "bg-production/70" : "bg-consumption/70";
  const arrow = tone === "source" ? "border-l-production" : "border-l-consumption";
  const style =
    side === "left"
      ? { left: "20px", right: "calc(50% + 142px)" }
      : { left: "calc(50% + 142px)", right: "20px" };

  return (
    <div
      className={cn("pointer-events-none absolute top-1/2 z-0 h-px -translate-y-1/2", line)}
      style={style}
    >
      <span
        className={cn(
          "absolute right-[-1px] top-1/2 h-0 w-0 -translate-y-1/2 border-y-[5px] border-l-[8px] border-y-transparent",
          arrow,
        )}
      />
    </div>
  );
}

function TopMetric({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-xl font-semibold", warn && "text-warning")}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{sub}</div>
    </div>
  );
}

function resourceIcon(type: PlantResource["type"]) {
  if (type === "Grid") return Cable;
  if (type === "Battery") return Battery;
  if (type === "PV" || type === "Generator") return Zap;
  if (type === "Test Bench") return Gauge;
  return Factory;
}
