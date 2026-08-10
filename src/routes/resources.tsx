import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Edit, Plus, Trash2 } from "lucide-react";
import { Panel } from "@/components/ems/Panel";
import { ResourceDialog } from "@/components/ems/ResourceDialog";
import { StatusDot } from "@/components/ems/StatusDot";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useUtiliqStore } from "@/lib/utiliq-store";
import type { PlantResource } from "@/lib/utiliq-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/resources")({
  head: () => ({
    meta: [
      { title: "Plant Resources - Utiliq" },
      {
        name: "description",
        content: "Physical plant infrastructure for test bench scheduling and energy constraints.",
      },
    ],
  }),
  component: PlantResourcesPage,
});

function PlantResourcesPage() {
  const { state, addResource, updateResource, deleteResource } = useUtiliqStore();
  const types = ["All", ...Array.from(new Set(state.resources.map((r) => r.type)))] as const;
  const [filter, setFilter] = useState<string>("All");
  const [editing, setEditing] = useState<PlantResource | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PlantResource | null>(null);

  const resources =
    filter === "All" ? state.resources : state.resources.filter((r) => r.type === filter);

  return (
    <div className="flex flex-col gap-3 p-3">
      <Panel contentClassName="flex flex-wrap items-center gap-3 p-3">
        <div className="px-2">
          <h1 className="text-sm font-semibold uppercase tracking-[0.14em]">Plant Resources</h1>
          <p className="text-[11px] text-muted-foreground">
            Create test benches, grid assets, PV, generators, battery, and support loads
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {types.map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={cn(
                  "rounded-sm border border-border px-2.5 py-1 text-[10px] uppercase tracking-wider",
                  filter === type
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {type}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add resource
          </Button>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {resources.map((resource) => (
          <Panel key={resource.id} contentClassName="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-xs text-primary">{resource.id}</div>
                <h2 className="mt-1 text-sm font-semibold">{resource.name}</h2>
                <div className="text-xs text-muted-foreground">
                  {resource.type} · {resource.location}
                </div>
              </div>
              <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider">
                <StatusDot status={resource.status} />
                {resource.status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Metric label="Capacity" value={capacityLabel(resource)} />
              <Metric label="Current" value={currentLabel(resource)} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Utilization</span>
                <span className="font-mono">{utilization(resource).toFixed(0)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted">
                <div
                  className={cn(
                    "h-1.5 rounded-full",
                    utilization(resource) > 85
                      ? "bg-warning"
                      : utilization(resource) > 0
                        ? "bg-running"
                        : "bg-idle",
                  )}
                  style={{ width: `${utilization(resource)}%` }}
                />
              </div>
            </div>
            {!!resource.compatibleRecipeIds?.length && (
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Compatible recipes
                </div>
                <div className="space-y-1 text-xs">
                  {resource.compatibleRecipeIds.map((id) => (
                    <div key={id}>{state.recipes.find((r) => r.id === id)?.name ?? id}</div>
                  ))}
                </div>
              </div>
            )}
            {resource.notes && <p className="text-xs text-muted-foreground">{resource.notes}</p>}
            <div className="flex justify-end gap-1 border-t border-border pt-2">
              <Button variant="ghost" size="icon" onClick={() => setEditing(resource)}>
                <Edit className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(resource)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </Panel>
        ))}
      </div>

      {/* Create */}
      <ResourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(r) => addResource(r)}
      />

      {/* Edit */}
      <ResourceDialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        resource={editing}
        onSubmit={(r) => {
          if (editing) updateResource(editing.id, r);
          setEditing(null);
        }}
      />

      {/* Confirm delete */}
      <AlertDialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{confirmDelete?.name}</strong> from the plant.
              Any scheduled assignments must be removed first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) deleteResource(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono">{value}</div>
    </div>
  );
}

function capacityLabel(resource: PlantResource) {
  if (resource.type === "Grid")
    return `${resource.maxGridExportMW ?? 0} MW export / ${resource.maxGridImportMW ?? 0} MW import`;
  if (resource.type === "Battery")
    return `${resource.batteryCapacityMWh ?? 0} MWh / ${resource.maxChargeDischargeMW ?? 0} MW`;
  if (resource.type === "Test Bench")
    return `${resource.minPowerMW ?? 0} to ${resource.maxPowerMW ?? 0} MW`;
  if (["PV", "Generator"].includes(resource.type))
    return `${resource.maxGenerationMW ?? 0} MW generation`;
  return `${resource.maxConsumptionMW ?? resource.maxPowerMW ?? 0} MW`;
}

function currentLabel(resource: PlantResource) {
  if (resource.type === "Battery")
    return `${Math.abs(resource.currentMW).toFixed(1)} MW ${resource.currentMW >= 0 ? "charge" : "discharge"} · ${resource.batteryStateOfChargePercent ?? 0}%`;
  if (resource.type === "Grid")
    return `${Math.abs(resource.currentMW).toFixed(1)} MW ${resource.currentMW >= 0 ? "export" : "import"}`;
  if (resource.currentMW === 0) return "0.0 MW";
  return `${resource.currentMW > 0 ? "+" : ""}${resource.currentMW.toFixed(1)} MW`;
}

function utilization(resource: PlantResource) {
  if (resource.utilizationPercent !== undefined) return resource.utilizationPercent;
  const denominator =
    resource.maxPowerMW ??
    resource.maxGenerationMW ??
    resource.maxConsumptionMW ??
    resource.maxChargeDischargeMW ??
    Math.max(1, Math.abs(resource.currentMW));
  return Math.min(100, (Math.abs(resource.currentMW) / denominator) * 100);
}
