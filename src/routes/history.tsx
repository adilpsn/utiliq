import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Panel } from "@/components/ems/Panel";
import { history } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Check, X, AlertTriangle, Search } from "lucide-react";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History — BenchOps EMS" },
      {
        name: "description",
        content: "Historical test bench runs with outcome, on-schedule indicator and duration.",
      },
    ],
  }),
  component: HistoryPage,
});

const OUTCOMES = ["all", "pass", "fail", "aborted"] as const;

function HistoryPage() {
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>("all");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("2024-05-17");
  const [to, setTo] = useState("2024-05-22");

  const rows = useMemo(() => {
    return history.filter((h) => {
      if (outcome !== "all" && h.outcome !== outcome) return false;
      if (h.date < from || h.date > to) return false;
      if (query) {
        const q = query.toLowerCase();
        if (
          ![h.product, h.serial, h.customer, h.benchId, h.id].some((v) =>
            v.toLowerCase().includes(q),
          )
        )
          return false;
      }
      return true;
    });
  }, [outcome, query, from, to]);

  const stats = useMemo(() => {
    const total = rows.length;
    const pass = rows.filter((r) => r.outcome === "pass").length;
    const onTime = rows.filter((r) => r.onSchedule).length;
    return {
      total,
      passRate: total ? Math.round((pass / total) * 100) : 0,
      onTimeRate: total ? Math.round((onTime / total) * 100) : 0,
    };
  }, [rows]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <Panel contentClassName="flex items-center gap-3 p-3">
        <div className="px-2">
          <h1 className="text-sm font-semibold uppercase tracking-[0.14em]">History</h1>
          <p className="text-[11px] text-muted-foreground">{stats.total} records</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-wider">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs"
            />
            <span className="uppercase tracking-wider">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs"
            />
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search product, serial, customer…"
              className="w-64 rounded-sm border border-border bg-background py-1 pl-7 pr-2 text-xs"
            />
          </div>
          <div className="flex gap-1">
            {OUTCOMES.map((o) => (
              <button
                key={o}
                onClick={() => setOutcome(o)}
                className={cn(
                  "rounded-sm border border-border px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors",
                  outcome === o
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-3">
        <Panel contentClassName="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Tests run
          </span>
          <span className="font-mono text-2xl font-semibold">{stats.total}</span>
        </Panel>
        <Panel contentClassName="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Pass rate
          </span>
          <span
            className={cn(
              "font-mono text-2xl font-semibold",
              stats.passRate >= 80 ? "text-running" : "text-warning",
            )}
          >
            {stats.passRate}%
          </span>
        </Panel>
        <Panel contentClassName="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            On schedule
          </span>
          <span
            className={cn(
              "font-mono text-2xl font-semibold",
              stats.onTimeRate >= 80 ? "text-running" : "text-warning",
            )}
          >
            {stats.onTimeRate}%
          </span>
        </Panel>
      </div>

      <Panel title="Test Records" contentClassName="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">ID</th>
              <th className="px-4 py-2 text-left font-medium">Date</th>
              <th className="px-4 py-2 text-left font-medium">Bench</th>
              <th className="px-4 py-2 text-left font-medium">Product</th>
              <th className="px-4 py-2 text-left font-medium">Serial</th>
              <th className="px-4 py-2 text-left font-medium">Customer</th>
              <th className="px-4 py-2 text-right font-medium">Duration</th>
              <th className="px-4 py-2 text-left font-medium">On schedule</th>
              <th className="px-4 py-2 text-left font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr
                key={h.id}
                className="border-b border-border/60 transition-colors hover:bg-accent/30"
              >
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{h.id}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{h.date}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{h.benchId}</td>
                <td className="px-4 py-2.5 font-medium">{h.product}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{h.serial}</td>
                <td className="px-4 py-2.5 text-xs">{h.customer}</td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {h.durationH} <span className="text-[10px] text-muted-foreground">h</span>
                </td>
                <td className="px-4 py-2.5">
                  {h.onSchedule ? (
                    <span className="inline-flex items-center gap-1 text-xs text-running">
                      <Check className="h-3.5 w-3.5" /> On time
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-warning">
                      <AlertTriangle className="h-3.5 w-3.5" /> Delayed
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {h.outcome === "pass" && (
                    <span className="inline-flex items-center gap-1 rounded-sm border border-running/40 bg-running/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-running">
                      <Check className="h-3 w-3" /> Pass
                    </span>
                  )}
                  {h.outcome === "fail" && (
                    <span className="inline-flex items-center gap-1 rounded-sm border border-fault/40 bg-fault/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fault">
                      <X className="h-3 w-3" /> Fail
                    </span>
                  )}
                  {h.outcome === "aborted" && (
                    <span className="inline-flex items-center gap-1 rounded-sm border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warning">
                      <AlertTriangle className="h-3 w-3" /> Aborted
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-xs text-muted-foreground">
                  No records match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
