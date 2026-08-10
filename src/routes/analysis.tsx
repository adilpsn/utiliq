import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowRight, Euro, Gauge, TrendingUp, Zap } from "lucide-react";
import { Panel } from "@/components/ems/Panel";
import { useUtiliqStore } from "@/lib/utiliq-store";
import { analyzeSpotMarket } from "@/lib/spot-market";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/analysis")({
  head: () => ({
    meta: [
      { title: "Spot Market Analysis - Utiliq" },
      {
        name: "description",
        content: "Optimize energy export timing against the day-ahead spot market price curve.",
      },
    ],
  }),
  component: AnalysisPage,
});

function AnalysisPage() {
  const { state } = useUtiliqStore();
  const analysis = useMemo(() => analyzeSpotMarket(state), [state]);

  const chartData = analysis.hours.map((h) => ({
    time: h.time,
    spotPrice: h.spotPrice,
    exportMW: h.exportMW,
    revenue: h.revenueEUR,
  }));

  return (
    <div className="flex flex-col gap-3 p-3">
      <Panel contentClassName="flex flex-wrap items-center gap-3 p-3">
        <div className="px-2">
          <h1 className="text-sm font-semibold uppercase tracking-[0.14em]">
            Spot Market Analysis
          </h1>
          <p className="text-[11px] text-muted-foreground">
            Align test-bench energy export with the day-ahead spot price curve
          </p>
        </div>
      </Panel>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label="Export revenue"
          value={`€${analysis.realizedRevenueEUR.toLocaleString("en-US")}`}
          icon={Euro}
          tone="running"
        />
        <KpiCard
          label="Captured price"
          value={`€${analysis.avgCapturedPriceEUR}`}
          unit="/MWh"
          icon={Gauge}
          tone={analysis.avgCapturedPriceEUR >= analysis.avgSpotPriceEUR ? "running" : "warning"}
        />
        <KpiCard
          label="Spot peak"
          value={`€${analysis.peakPriceEUR}`}
          unit={`/MWh @ ${String(analysis.peakHour).padStart(2, "0")}:00`}
          icon={TrendingUp}
          tone="primary"
        />
        <KpiCard
          label="Price alignment"
          value={`${analysis.alignmentPct}`}
          unit="%"
          icon={Zap}
          tone={
            analysis.alignmentPct >= 80
              ? "running"
              : analysis.alignmentPct >= 50
                ? "warning"
                : "fault"
          }
        />
        <KpiCard
          label="Missed revenue"
          value={`€${analysis.missedRevenueEUR.toLocaleString("en-US")}`}
          icon={Euro}
          tone={analysis.missedRevenueEUR > 0 ? "warning" : "running"}
        />
      </div>

      <div className="grid grid-cols-12 gap-3">
        {/* Spot price vs export overlay */}
        <Panel title="Spot Price vs. Scheduled Export" className="col-span-12 xl:col-span-8">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
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
                  yAxisId="price"
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  width={42}
                  label={{
                    value: "€/MWh",
                    angle: -90,
                    position: "insideLeft",
                    fontSize: 10,
                    fill: "var(--color-muted-foreground)",
                  }}
                />
                <YAxis
                  yAxisId="power"
                  orientation="right"
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  width={36}
                  label={{
                    value: "MW",
                    angle: 90,
                    position: "insideRight",
                    fontSize: 10,
                    fill: "var(--color-muted-foreground)",
                  }}
                />
                <RTooltip
                  contentStyle={{
                    background: "var(--color-panel)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 2,
                    fontSize: 12,
                  }}
                />
                <ReferenceLine
                  yAxisId="price"
                  y={analysis.avgSpotPriceEUR}
                  stroke="var(--color-muted-foreground)"
                  strokeDasharray="4 3"
                  label={{
                    value: `avg €${analysis.avgSpotPriceEUR}`,
                    fontSize: 9,
                    fill: "var(--color-muted-foreground)",
                    position: "insideTopRight",
                  }}
                />
                <Bar
                  yAxisId="power"
                  dataKey="exportMW"
                  name="Export MW"
                  fill="var(--color-running)"
                  fillOpacity={0.45}
                  radius={[2, 2, 0, 0]}
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="spotPrice"
                  name="Spot €/MWh"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Export bars rising under the price peak earn the most. Bars under the dashed average
            line are sold below the day's mean price.
          </p>
        </Panel>

        {/* Recommendations */}
        <Panel title="Optimization Opportunities" className="col-span-12 xl:col-span-4">
          {analysis.recommendations.length ? (
            <ul className="space-y-2.5 text-sm">
              {analysis.recommendations.map((rec, i) => (
                <li
                  key={`${rec.fromHour}-${rec.toHour}-${i}`}
                  className="rounded-sm border border-border bg-background/40 p-2.5"
                >
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="text-warning">{String(rec.fromHour).padStart(2, "0")}:00</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="text-running">{String(rec.toHour).padStart(2, "0")}:00</span>
                    <span className="ml-auto font-semibold text-running">+€{rec.gainEUR}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Move {rec.energyMWh} MWh of export into the higher-price window.
                  </div>
                </li>
              ))}
              <li className="border-t border-border pt-2 text-xs text-muted-foreground">
                Total upside ≈{" "}
                <span className="font-mono font-semibold text-running">
                  €
                  {analysis.recommendations
                    .reduce((sum, r) => sum + r.gainEUR, 0)
                    .toLocaleString("en-US")}
                </span>{" "}
                by rescheduling export-heavy tests toward peak-price hours.
              </li>
            </ul>
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {analysis.exportedMWh > 0
                ? "Export is already well aligned with the spot price peaks. No profitable shifts found."
                : "No net export scheduled. Schedule generating tests to capture spot-market revenue."}
            </div>
          )}
        </Panel>
      </div>

      {/* Hourly breakdown table */}
      <Panel title="Hourly Spot Breakdown" contentClassName="overflow-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">Hour</th>
              <th className="px-4 py-2 text-right font-medium">Spot €/MWh</th>
              <th className="px-4 py-2 text-right font-medium">Export MW</th>
              <th className="px-4 py-2 text-right font-medium">Revenue €</th>
              <th className="px-4 py-2 text-left font-medium">vs. avg</th>
            </tr>
          </thead>
          <tbody>
            {analysis.hours
              .filter((h) => h.exportMW > 0.01 || (h.hour >= 6 && h.hour <= 21))
              .map((h) => {
                const aboveAvg = h.spotPrice >= analysis.avgSpotPriceEUR;
                return (
                  <tr key={h.hour} className="border-b border-border/60 hover:bg-accent/30">
                    <td className="px-4 py-2 font-mono text-xs">{h.time}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">€{h.spotPrice}</td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right font-mono text-xs",
                        h.exportMW > 0 ? "text-running" : "text-muted-foreground",
                      )}
                    >
                      {h.exportMW.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {h.revenueEUR > 0 ? `€${h.revenueEUR.toFixed(0)}` : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                          aboveAvg
                            ? "border-running/40 bg-running/10 text-running"
                            : "border-warning/40 bg-warning/10 text-warning",
                        )}
                      >
                        {aboveAvg ? "premium" : "discount"}
                      </span>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

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
  tone?: "warning" | "running" | "primary" | "fault";
}) {
  return (
    <Panel contentClassName="flex items-center gap-3 p-3">
      <div
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-sm bg-muted text-muted-foreground",
          tone === "warning" && "bg-warning/10 text-warning",
          tone === "running" && "bg-running/10 text-running",
          tone === "primary" && "bg-primary/10 text-primary",
          tone === "fault" && "bg-fault/10 text-fault",
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
