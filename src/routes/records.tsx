import { createFileRoute } from "@tanstack/react-router";
import { differenceInMinutes } from "date-fns";
import { useMemo, useState } from "react";
import { AlertTriangle, Check, Search, X } from "lucide-react";
import { Panel } from "@/components/ems/Panel";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUtiliqStore } from "@/lib/utiliq-store";
import { formatDateTime, parseDate } from "@/lib/utiliq-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/records")({
  head: () => ({
    meta: [
      { title: "Test Records - Utiliq" },
      {
        name: "description",
        content:
          "Completed test records with outcome, energy, cost impact, and schedule adherence.",
      },
    ],
  }),
  component: TestRecordsPage,
});

const outcomes = ["all", "pass", "fail", "aborted"] as const;

function TestRecordsPage() {
  const { state } = useUtiliqStore();
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<(typeof outcomes)[number]>("all");
  const [bench, setBench] = useState("all");
  const [model, setModel] = useState("all");

  const rows = useMemo(() => {
    return state.records.filter((record) => {
      if (outcome !== "all" && record.outcome !== outcome) return false;
      if (bench !== "all" && record.benchId !== bench) return false;
      if (model !== "all" && record.modelName !== model) return false;
      if (query) {
        const item = state.testItems.find((candidate) => candidate.id === record.testItemId);
        const haystack = [
          record.serialNumber,
          record.modelName,
          record.benchId,
          record.notes,
          item?.customerName,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query.toLowerCase())) return false;
      }
      return true;
    });
  }, [state.records, state.testItems, query, outcome, bench, model]);

  const stats = useMemo(() => {
    const total = rows.length;
    const pass = rows.filter((row) => row.outcome === "pass").length;
    const delays = rows.map((row) =>
      differenceInMinutes(
        parseDate(row.actualEnd ?? row.scheduledEnd),
        parseDate(row.scheduledEnd),
      ),
    );
    const adherence = total
      ? Math.round(
          (rows.filter(
            (row) =>
              (row.actualEnd
                ? differenceInMinutes(parseDate(row.actualEnd), parseDate(row.scheduledEnd))
                : 0) <= 30,
          ).length /
            total) *
            100,
        )
      : 0;
    return {
      total,
      passRate: total ? Math.round((pass / total) * 100) : 0,
      averageDelay: total ? Math.round(delays.reduce((sum, delay) => sum + delay, 0) / total) : 0,
      adherence,
      generated: rows.reduce((sum, row) => sum + (row.energyGeneratedMWh ?? 0), 0),
      curtailed: rows.reduce((sum, row) => sum + (row.energyCurtailedMWh ?? 0), 0),
      savings: rows.reduce((sum, row) => sum + (row.estimatedCostImpactEUR ?? 0), 0),
    };
  }, [rows]);

  const models = Array.from(new Set(state.records.map((record) => record.modelName)));

  return (
    <div className="flex flex-col gap-3 p-3">
      <Panel contentClassName="flex flex-wrap items-center gap-3 p-3">
        <div className="px-2">
          <h1 className="text-sm font-semibold uppercase tracking-[0.14em]">Test Records</h1>
          <p className="text-[11px] text-muted-foreground">
            {rows.length} completed or closed tests
          </p>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
        <Stat label="Tests completed" value={String(stats.total)} />
        <Stat label="Pass rate" value={`${stats.passRate}%`} good={stats.passRate >= 90} />
        <Stat
          label="Average delay"
          value={`${stats.averageDelay}m`}
          warn={stats.averageDelay > 30}
        />
        <Stat
          label="Schedule adherence"
          value={`${stats.adherence}%`}
          good={stats.adherence >= 85}
        />
        <Stat label="Energy generated" value={`${stats.generated.toFixed(1)} MWh`} />
        <Stat
          label="Energy curtailed"
          value={`${stats.curtailed.toFixed(1)} MWh`}
          warn={stats.curtailed > 5}
        />
        <Stat
          label="Cost impact"
          value={`€${Math.round(stats.savings).toLocaleString("en-US")}`}
          good={stats.savings > 0}
        />
      </div>

      <Panel contentClassName="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-72 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search serial, customer, notes"
            className="pl-7"
          />
        </div>
        <Select value={outcome} onValueChange={(value) => setOutcome(value as typeof outcome)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {outcomes.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={bench} onValueChange={setBench}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all benches</SelectItem>
            {state.benches.map((value) => (
              <SelectItem key={value.id} value={value.id}>
                {value.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all models</SelectItem>
            {models.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Panel>

      <Panel title="Historical Test Records" contentClassName="overflow-auto p-0">
        <table className="w-full min-w-[1180px] text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">Serial No.</th>
              <th className="px-4 py-2 text-left font-medium">Model</th>
              <th className="px-4 py-2 text-left font-medium">Bench</th>
              <th className="px-4 py-2 text-left font-medium">Scheduled Start</th>
              <th className="px-4 py-2 text-left font-medium">Actual Start</th>
              <th className="px-4 py-2 text-left font-medium">Scheduled End</th>
              <th className="px-4 py-2 text-left font-medium">Actual End</th>
              <th className="px-4 py-2 text-left font-medium">Outcome</th>
              <th className="px-4 py-2 text-right font-medium">Generated</th>
              <th className="px-4 py-2 text-right font-medium">Exported</th>
              <th className="px-4 py-2 text-right font-medium">Curtailed</th>
              <th className="px-4 py-2 text-right font-medium">Cost Impact</th>
              <th className="px-4 py-2 text-left font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((record) => (
              <tr key={record.id} className="border-b border-border/60 hover:bg-accent/30">
                <td className="px-4 py-2.5 font-mono text-xs text-primary">
                  {record.serialNumber}
                </td>
                <td className="px-4 py-2.5 font-medium">{record.modelName}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{record.benchId}</td>
                <td className="px-4 py-2.5 font-mono text-xs">
                  {formatDateTime(record.scheduledStart)}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">
                  {record.actualStart ? formatDateTime(record.actualStart) : "-"}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">
                  {formatDateTime(record.scheduledEnd)}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">
                  {record.actualEnd ? formatDateTime(record.actualEnd) : "-"}
                </td>
                <td className="px-4 py-2.5">
                  <Outcome outcome={record.outcome} />
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {(record.energyGeneratedMWh ?? 0).toFixed(1)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {(record.energyExportedMWh ?? 0).toFixed(1)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {(record.energyCurtailedMWh ?? 0).toFixed(1)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  €{Math.round(record.estimatedCostImpactEUR ?? 0).toLocaleString("en-US")}
                </td>
                <td className="max-w-64 truncate px-4 py-2.5 text-xs text-muted-foreground">
                  {record.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
  good,
}: {
  label: string;
  value: string;
  warn?: boolean;
  good?: boolean;
}) {
  return (
    <Panel contentClassName="p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 font-mono text-xl font-semibold",
          warn && "text-warning",
          good && "text-running",
        )}
      >
        {value}
      </div>
    </Panel>
  );
}

function Outcome({ outcome }: { outcome: "pass" | "fail" | "aborted" }) {
  if (outcome === "pass")
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-running/40 bg-running/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-running">
        <Check className="h-3 w-3" />
        Pass
      </span>
    );
  if (outcome === "fail")
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-fault/40 bg-fault/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-fault">
        <X className="h-3 w-3" />
        Fail
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-warning">
      <AlertTriangle className="h-3 w-3" />
      Aborted
    </span>
  );
}
