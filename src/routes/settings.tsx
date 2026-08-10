import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { RotateCcw, SlidersHorizontal, Zap } from "lucide-react";
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
import { Panel } from "@/components/ems/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useUtiliqStore } from "@/lib/utiliq-store";
import type { OptimizationPreset } from "@/lib/utiliq-types";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings & Optimization - Utiliq" },
      {
        name: "description",
        content:
          "Mock grid constraints and optimization strategy settings for the Utiliq scheduler.",
      },
    ],
  }),
  component: SettingsPage,
});

const presets: OptimizationPreset[] = [
  "balanced",
  "deadline-first",
  "cost-optimized",
  "grid-safe",
  "throughput",
];

function SettingsPage() {
  const { state, updateEnergyConstraint, updateOptimizationSettings, resetDemoData } =
    useUtiliqStore();
  const weights = state.optimizationSettings.weights;
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="flex flex-col gap-3 p-3">
      <Panel contentClassName="flex flex-wrap items-center gap-3 p-3">
        <div className="px-2">
          <h1 className="text-sm font-semibold uppercase tracking-[0.14em]">
            Settings / Optimization
          </h1>
          <p className="text-[11px] text-muted-foreground">
            Configure scheduling constraints and strategy weights for the demo scheduler
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => setConfirmReset(true)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset demo data
        </Button>
      </Panel>

      <div className="grid grid-cols-12 gap-3">
        <Panel title="Grid Constraints" className="col-span-12 lg:col-span-5">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Max grid export MW"
              value={state.energyConstraint.maxGridExportMW}
              onChange={(value) => updateEnergyConstraint({ maxGridExportMW: value })}
            />
            <NumberField
              label="Max grid import MW"
              value={state.energyConstraint.maxGridImportMW}
              onChange={(value) => updateEnergyConstraint({ maxGridImportMW: value })}
            />
            <NumberField
              label="Facility base load MW"
              value={state.energyConstraint.facilityBaseLoadMW}
              onChange={(value) => updateEnergyConstraint({ facilityBaseLoadMW: value })}
            />
            <NumberField
              label="Battery capacity MWh"
              value={state.energyConstraint.batteryCapacityMWh ?? 0}
              onChange={(value) => updateEnergyConstraint({ batteryCapacityMWh: value })}
            />
            <NumberField
              label="Battery SOC %"
              value={state.energyConstraint.batteryStateOfChargePercent ?? 0}
              onChange={(value) => updateEnergyConstraint({ batteryStateOfChargePercent: value })}
            />
          </div>
        </Panel>

        <Panel title="Strategy Preset" className="col-span-12 lg:col-span-3">
          <div className="space-y-4">
            <div>
              <Label className="text-[10px] uppercase tracking-wider">Preset</Label>
              <Select
                value={state.optimizationSettings.preset}
                onValueChange={(preset) =>
                  updateOptimizationSettings({ preset: preset as OptimizationPreset })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {preset}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-sm border border-border bg-background/40 p-3 text-xs text-muted-foreground">
              <div className="mb-2 flex items-center gap-2 text-foreground">
                <Zap className="h-3.5 w-3.5 text-primary" /> Active behavior
              </div>
              {state.optimizationSettings.preset === "deadline-first" &&
                "Prioritizes urgent deadlines even when energy prices are less attractive."}
              {state.optimizationSettings.preset === "cost-optimized" &&
                "Prefers lower-cost import windows and export revenue while respecting deadlines."}
              {state.optimizationSettings.preset === "grid-safe" &&
                "Strongly penalizes import/export cap violations and curtailment risk."}
              {state.optimizationSettings.preset === "throughput" &&
                "Fills bench capacity earlier and reduces idle time across the 7-day horizon."}
              {state.optimizationSettings.preset === "balanced" &&
                "Balances deadline risk, grid limits, curtailment, cost, utilization, and overtime."}
            </div>
          </div>
        </Panel>

        <Panel title="Optimization Weights" className="col-span-12 lg:col-span-4">
          <div className="space-y-4">
            <Weight
              label="Meet deadlines"
              value={weights.meetDeadlines}
              onChange={(value) =>
                updateOptimizationSettings({ weights: { meetDeadlines: value } })
              }
            />
            <Weight
              label="Reduce energy cost"
              value={weights.reduceEnergyCost}
              onChange={(value) =>
                updateOptimizationSettings({ weights: { reduceEnergyCost: value } })
              }
            />
            <Weight
              label="Avoid grid cap violations"
              value={weights.avoidGridCaps}
              onChange={(value) =>
                updateOptimizationSettings({ weights: { avoidGridCaps: value } })
              }
            />
            <Weight
              label="Maximize bench utilization"
              value={weights.maximizeUtilization}
              onChange={(value) =>
                updateOptimizationSettings({ weights: { maximizeUtilization: value } })
              }
            />
            <Weight
              label="Reduce overtime"
              value={weights.reduceOvertime}
              onChange={(value) =>
                updateOptimizationSettings({ weights: { reduceOvertime: value } })
              }
            />
            <Weight
              label="Minimize curtailed energy"
              value={weights.minimizeCurtailment}
              onChange={(value) =>
                updateOptimizationSettings({ weights: { minimizeCurtailment: value } })
              }
            />
          </div>
        </Panel>
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will discard all schedule assignments, test items, and resource changes and
              restore the original demo state. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                resetDemoData();
                setConfirmReset(false);
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider">{label}</Label>
      <Input
        type="number"
        step="0.1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function Weight({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <Label className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
          <SlidersHorizontal className="h-3 w-3" />
          {label}
        </Label>
        <span className="font-mono text-xs text-muted-foreground">{value}</span>
      </div>
      <Slider
        value={[value]}
        min={0}
        max={100}
        step={1}
        onValueChange={([next]) => onChange(next)}
      />
    </div>
  );
}
