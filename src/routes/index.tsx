import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import type React from "react";
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
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleGauge,
  ClipboardList,
  Euro,
  Gauge,
  Play,
  Zap,
} from "lucide-react";
import { Panel } from "@/components/ems/Panel";
import { StatusDot } from "@/components/ems/StatusDot";
import { Button } from "@/components/ui/button";
import { useUtiliqStore } from "@/lib/utiliq-store";
import {
  buildEnergyForecast,
  calculateImpact,
  calculateKpis,
  collectAlerts,
  formatDateTime,
  formatTime,
  gridFlowAt,
  integrateProfileMWh,
  parseDate,
} from "@/lib/utiliq-engine";
import { nowIso } from "@/lib/clock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Command Center - Utiliq" },
      {
        name: "description",
        content: "Production test scheduling command center for industrial test benches.",
      },
    ],
  }),
  component: CommandCenterPage,
});

function KpiCard({
  label,
  value,
  unit,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "warning" | "running" | "primary";
}) {
  return (
    <Panel contentClassName="flex items-center gap-3 p-3">
      <div
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-sm bg-muted text-muted-foreground",
          tone === "warning" && "bg-warning/10 text-warning",
          tone === "running" && "bg-running/10 text-running",
          tone === "primary" && "bg-primary/10 text-primary",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="font-mono text-xl font-semibold">{value}</span>
          {unit && <span className="text-[10px] text-muted-foreground">{unit}</span>}
        </div>
      </div>
    </Panel>
  );
}

function CommandCenterPage() {
  const { state, autoScheduleItems } = useUtiliqStore();
  const kpis = useMemo(() => calculateKpis(state), [state]);
  const impact = useMemo(() => calculateImpact(state), [state]);
  const forecast = useMemo(() => buildEnergyForecast(state), [state]);
  const alerts = useMemo(() => collectAlerts(state), [state]);
  const now = parseDate(nowIso());
  const waitingIds = state.testItems
    .filter((item) => item.status === "waiting" || item.status === "delayed")
    .map((item) => item.id);
  const mostUrgentWaiting = state.testItems
    .filter((item) => item.status === "waiting" || item.status === "delayed")
    .sort((a, b) => parseDate(a.deadline).getTime() - parseDate(b.deadline).getTime())[0];
  const firstScheduleWarning = state.assignments.flatMap(
    (assignment) => assignment.warnings ?? [],
  )[0];
  const todayPlan = state.assignments
    .filter((assignment) => parseDate(assignment.start).toDateString() === now.toDateString())
    .sort((a, b) => parseDate(a.start).getTime() - parseDate(b.start).getTime())
    .map((assignment) => ({
      assignment,
      item: state.testItems.find((candidate) => candidate.id === assignment.testItemId),
      bench: state.benches.find((candidate) => candidate.id === assignment.benchId),
    }));
  const currentGrid = gridFlowAt(
    state.assignments,
    state.testItems,
    state.resources,
    state.energyConstraint,
    now,
  );

  return (
    <div className="flex flex-col gap-3 p-3">
      <Panel contentClassName="flex flex-wrap items-center gap-3 p-3">
        <div className="px-2">
          <h1 className="text-sm font-semibold uppercase tracking-[0.14em]">Command Center</h1>
          <p className="text-[11px] text-muted-foreground">
            Production-ready hardware test planning · {formatDateTime(nowIso())}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/queue">Open queue</Link>
          </Button>
          <Button size="sm" onClick={() => autoScheduleItems(waitingIds)}>
            <Zap className="h-3.5 w-3.5" />
            Run optimizer
          </Button>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label="Waiting for test"
          value={String(kpis.waiting)}
          icon={ClipboardList}
          tone={kpis.waiting ? "warning" : "running"}
        />
        <KpiCard
          label="Scheduled today"
          value={String(kpis.scheduledToday)}
          icon={CalendarClock}
          tone="primary"
        />
        <KpiCard label="Running now" value={String(kpis.running)} icon={Play} tone="running" />
        <KpiCard
          label="Completed week"
          value={String(kpis.completedThisWeek)}
          icon={CheckCircle2}
          tone="running"
        />
        <KpiCard
          label="Deadline risks"
          value={String(kpis.deadlineRisks)}
          icon={AlertTriangle}
          tone={kpis.deadlineRisks ? "warning" : "running"}
        />
        <KpiCard
          label="Bench utilization"
          value={String(kpis.benchUtilization)}
          unit="%"
          icon={CircleGauge}
        />
        <KpiCard
          label="Grid flow"
          value={Math.abs(currentGrid).toFixed(1)}
          unit={currentGrid >= 0 ? "MW export" : "MW import"}
          icon={Gauge}
          tone={currentGrid > state.energyConstraint.maxGridExportMW * 0.85 ? "warning" : "primary"}
        />
        <KpiCard
          label="Grid headroom"
          value={kpis.gridHeadroom.toFixed(1)}
          unit="MW"
          icon={Zap}
          tone={kpis.gridHeadroom < 1 ? "warning" : "running"}
        />
        <KpiCard
          label="Est. schedule value"
          value={`€${Math.round(impact.estimatedSavingsEUR).toLocaleString("en-US")}`}
          icon={Euro}
          tone="running"
        />
        <KpiCard
          label="Curtailed avoided"
          value={kpis.curtailedAvoidedMWh.toFixed(1)}
          unit="MWh"
          icon={Zap}
          tone="running"
        />
      </div>

      <div className="grid grid-cols-12 gap-3">
        <Panel
          title="Today's Test Plan"
          className="col-span-12 xl:col-span-7"
          contentClassName="p-0"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Time</th>
                <th className="px-4 py-2 text-left font-medium">Serial</th>
                <th className="px-4 py-2 text-left font-medium">Model</th>
                <th className="px-4 py-2 text-left font-medium">Bench</th>
                <th className="px-4 py-2 text-right font-medium">Profile</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {todayPlan.map(({ assignment, item, bench }) => {
                const energy = item ? integrateProfileMWh(item) : { generated: 0, consumed: 0 };
                const maxGeneration = item
                  ? Math.max(...item.expectedPowerProfile.map((point) => point.powerMW))
                  : 0;
                const maxConsumption = item
                  ? Math.min(...item.expectedPowerProfile.map((point) => point.powerMW))
                  : 0;
                const peak =
                  Math.abs(maxConsumption) > maxGeneration ? maxConsumption : maxGeneration;
                return (
                  <tr key={assignment.id} className="border-b border-border/60 hover:bg-accent/30">
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {formatTime(assignment.start)}-{formatTime(assignment.end)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-primary">
                      {item?.serialNumber}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{item?.modelName}</div>
                      <div className="text-[11px] text-muted-foreground">{item?.customerName}</div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{bench?.id}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {peak >= 0 ? "+" : ""}
                      {peak.toFixed(1)} MW
                      <div className="text-[10px] text-muted-foreground">
                        {energy.generated.toFixed(1)} MWh gen · {energy.consumed.toFixed(1)} MWh
                        cons
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2 text-xs uppercase tracking-wider">
                        <StatusDot status={item?.status ?? "idle"} />
                        {item?.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>

        <Panel title="Energy Forecast" className="col-span-12 xl:col-span-5">
          <div className="h-64">
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
                  tickLine={false}
                  interval={2}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  width={36}
                />
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
                  strokeWidth={1.5}
                  name="Grid MW"
                />
                <Line
                  type="monotone"
                  dataKey="exportCap"
                  stroke="var(--color-warning)"
                  strokeDasharray="4 3"
                  dot={false}
                  name="Export cap"
                />
                <Line
                  type="monotone"
                  dataKey="importCap"
                  stroke="var(--color-fault)"
                  strokeDasharray="4 3"
                  dot={false}
                  name="Import cap"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <Panel title="Alerts" className="col-span-12 lg:col-span-6">
          <ul className="space-y-2.5 text-sm">
            {alerts.map((alert, index) => (
              <li
                key={`${alert.text}-${index}`}
                className="flex items-start gap-2 border-b border-border/50 pb-2 last:border-b-0"
              >
                <StatusDot
                  status={
                    alert.severity === "critical"
                      ? "fault"
                      : alert.severity === "warning"
                        ? "warning"
                        : "idle"
                  }
                  className="mt-1.5"
                />
                <span>{alert.text}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Recommended Actions" className="col-span-12 lg:col-span-6">
          <div className="grid gap-2 text-sm">
            <ActionLine
              title={`Run optimizer for ${waitingIds.length} unscheduled units`}
              detail="Create feasible test-bench slots with grid and deadline scoring."
              action={
                <Button size="sm" onClick={() => autoScheduleItems(waitingIds)}>
                  Auto schedule
                </Button>
              }
            />
            <ActionLine
              title={
                mostUrgentWaiting
                  ? `Review deadline risk for ${mostUrgentWaiting.serialNumber}`
                  : firstScheduleWarning
                    ? "Review schedule warning"
                    : "Check inactive bench capacity"
              }
              detail={
                mostUrgentWaiting
                  ? `${mostUrgentWaiting.modelName} is waiting and due ${formatDateTime(mostUrgentWaiting.deadline)}.`
                  : (firstScheduleWarning?.message ??
                    "Live Energy shows which benches are inactive and ready for work.")
              }
              action={
                <Button size="sm" variant="outline" asChild>
                  <Link
                    to={mostUrgentWaiting || firstScheduleWarning ? "/schedule" : "/live-energy"}
                  >
                    Inspect
                  </Link>
                </Button>
              }
            />
            <ActionLine
              title="Approve optimized schedule"
              detail={`Current plan estimates €${Math.round(impact.estimatedSavingsEUR).toLocaleString("en-US")} value and ${impact.curtailedMWh.toFixed(1)} MWh curtailment.`}
              action={
                <Button size="sm" variant="outline" asChild>
                  <Link to="/schedule">Compare</Link>
                </Button>
              }
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ActionLine({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border/50 pb-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      {action}
    </div>
  );
}
