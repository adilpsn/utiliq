import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Panel } from "@/components/ems/Panel";
import { StatusDot, StatusLabel } from "@/components/ems/StatusDot";
import { assets, type Asset } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/assets")({
  head: () => ({
    meta: [
      { title: "Assets — BenchOps EMS" },
      {
        name: "description",
        content:
          "Catalogue of generators, test benches, batteries and consumers with live status, capacity and location.",
      },
    ],
  }),
  component: AssetsPage,
});

const TYPES: Asset["type"][] = ["Generator", "Test Bench", "Battery", "Grid", "PV", "Consumer"];

function AssetsPage() {
  const [filter, setFilter] = useState<Asset["type"] | "All">("All");
  const filtered = filter === "All" ? assets : assets.filter((a) => a.type === filter);

  return (
    <div className="flex flex-col gap-3 p-3">
      <Panel contentClassName="flex items-center gap-3 p-3">
        <div className="px-2">
          <h1 className="text-sm font-semibold uppercase tracking-[0.14em]">Assets</h1>
          <p className="text-[11px] text-muted-foreground">
            {filtered.length} of {assets.length} units
          </p>
        </div>
        <div className="ml-auto flex gap-1">
          {(["All", ...TYPES] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={cn(
                "rounded-sm border border-border px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors",
                filter === t
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Asset Register" contentClassName="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">ID</th>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Current</th>
              <th className="px-4 py-2 text-right font-medium">Capacity</th>
              <th className="px-4 py-2 text-left font-medium">Utilization</th>
              <th className="px-4 py-2 text-left font-medium">Location</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const util = a.capacityMW > 0 ? Math.min(100, (a.currentMW / a.capacityMW) * 100) : 0;
              return (
                <tr
                  key={a.id}
                  className="border-b border-border/60 transition-colors hover:bg-accent/30"
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{a.id}</td>
                  <td className="px-4 py-2.5 font-medium">{a.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.type}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <StatusDot status={a.status} />
                      <StatusLabel status={a.status} />
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {a.currentMW.toFixed(2)}{" "}
                    <span className="text-[10px] text-muted-foreground">MW</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                    {a.capacityMW.toFixed(2)} <span className="text-[10px]">MW</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-24 rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-1 rounded-full",
                            util > 80 ? "bg-warning" : util > 0 ? "bg-running" : "bg-idle",
                          )}
                          style={{ width: `${util}%` }}
                        />
                      </div>
                      <span className="w-8 font-mono text-[10px] text-muted-foreground">
                        {util.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.location}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
