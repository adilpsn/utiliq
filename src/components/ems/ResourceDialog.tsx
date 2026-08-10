import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUtiliqStore } from "@/lib/utiliq-store";
import type { PlantResource } from "@/lib/utiliq-types";

const resourceTypes: PlantResource["type"][] = [
  "Test Bench",
  "Grid",
  "Battery",
  "PV",
  "Generator",
  "Load Bank",
  "Facility Load",
  "Cooling",
  "Compressed Air",
  "Fuel Supply",
];

type ResourceForm = {
  name: string;
  type: PlantResource["type"];
  status: string;
  location: string;
  currentMW: number;
  notes: string;
  benchType: string;
  minPowerMW: number;
  maxPowerMW: number;
  compatibleRecipeIds: string[];
  maxGenerationMW: number;
  maxConsumptionMW: number;
  batteryCapacityMWh: number;
  maxChargeDischargeMW: number;
  batteryStateOfChargePercent: number;
  maxGridImportMW: number;
  maxGridExportMW: number;
};

export function initialResourceForm(resource?: PlantResource | null): ResourceForm {
  return {
    name: resource?.name ?? "New test bench",
    type: resource?.type ?? "Test Bench",
    status: resource?.status ?? "available",
    location: resource?.location ?? "Hall B",
    currentMW: resource?.currentMW ?? 0,
    notes: resource?.notes ?? "",
    benchType: resource?.benchType ?? "CHP dyno",
    minPowerMW: resource?.minPowerMW ?? 0,
    maxPowerMW: resource?.maxPowerMW ?? 4,
    compatibleRecipeIds: resource?.compatibleRecipeIds ?? [],
    maxGenerationMW: resource?.maxGenerationMW ?? 1,
    maxConsumptionMW: resource?.maxConsumptionMW ?? 1,
    batteryCapacityMWh: resource?.batteryCapacityMWh ?? 8,
    maxChargeDischargeMW: resource?.maxChargeDischargeMW ?? 2,
    batteryStateOfChargePercent: resource?.batteryStateOfChargePercent ?? 50,
    maxGridImportMW: resource?.maxGridImportMW ?? 4.5,
    maxGridExportMW: resource?.maxGridExportMW ?? 5,
  };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource?: PlantResource | null;
  onSubmit: (resource: Omit<PlantResource, "id"> & { id?: string }) => void;
};

export function ResourceDialog({ open, onOpenChange, resource, onSubmit }: Props) {
  const { state } = useUtiliqStore();
  const [form, setForm] = useState<ResourceForm>(() => initialResourceForm(resource));
  const isEdit = Boolean(resource);

  useEffect(() => {
    if (open) setForm(initialResourceForm(resource));
  }, [open, resource]);

  const submit = () => {
    const next: Omit<PlantResource, "id"> & { id?: string } = {
      id: resource?.id,
      name: form.name,
      type: form.type,
      status: form.status,
      location: form.location,
      currentMW: form.currentMW,
      notes: form.notes,
      utilizationPercent: undefined,
    };
    if (form.type === "Test Bench") {
      next.benchType = form.benchType;
      next.minPowerMW = form.minPowerMW;
      next.maxPowerMW = form.maxPowerMW;
      next.compatibleRecipeIds = form.compatibleRecipeIds;
      next.compatibleTestTypes = form.compatibleRecipeIds.map(
        (id) => state.recipes.find((r) => r.id === id)?.requiredBenchType ?? id,
      );
    }
    if (["PV", "Generator"].includes(form.type)) {
      next.maxGenerationMW = form.maxGenerationMW;
      next.currentGenerationMW = Math.max(0, form.currentMW);
    }
    if (
      ["Load Bank", "Facility Load", "Cooling", "Compressed Air", "Fuel Supply"].includes(form.type)
    ) {
      next.maxConsumptionMW = form.maxConsumptionMW;
      next.currentConsumptionMW = Math.abs(Math.min(0, form.currentMW));
    }
    if (form.type === "Battery") {
      next.batteryCapacityMWh = form.batteryCapacityMWh;
      next.maxChargeDischargeMW = form.maxChargeDischargeMW;
      next.batteryStateOfChargePercent = form.batteryStateOfChargePercent;
    }
    if (form.type === "Grid") {
      next.maxGridImportMW = form.maxGridImportMW;
      next.maxGridExportMW = form.maxGridExportMW;
    }
    onSubmit(next);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-panel">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit plant resource" : "Add plant resource"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <Field label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <div>
            <Label className="text-[10px] uppercase tracking-wider">Type</Label>
            <Select
              value={form.type}
              onValueChange={(type) => setForm({ ...form, type: type as PlantResource["type"] })}
              disabled={isEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {resourceTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field
            label="Status"
            value={form.status}
            onChange={(status) => setForm({ ...form, status })}
          />
          <Field
            label="Location"
            value={form.location}
            onChange={(location) => setForm({ ...form, location })}
          />
          <NumberField
            label="Current MW"
            value={form.currentMW}
            onChange={(currentMW) => setForm({ ...form, currentMW })}
          />
          {form.type === "Test Bench" && (
            <>
              <Field
                label="Bench type"
                value={form.benchType}
                onChange={(benchType) => setForm({ ...form, benchType })}
              />
              <div className="col-span-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm({ ...form, benchType: "CHP dyno", minPowerMW: 0, maxPowerMW: 5 })
                  }
                >
                  CHP / generator
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm({
                      ...form,
                      benchType: "Heat pump bench",
                      minPowerMW: -3,
                      maxPowerMW: 0,
                    })
                  }
                >
                  Heat pump / consuming
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm({ ...form, benchType: "Battery bench", minPowerMW: -4, maxPowerMW: 4 })
                  }
                >
                  Bidirectional
                </Button>
              </div>
              <NumberField
                label="Minimum power MW"
                value={form.minPowerMW}
                onChange={(minPowerMW) => setForm({ ...form, minPowerMW })}
              />
              <NumberField
                label="Maximum power MW"
                value={form.maxPowerMW}
                onChange={(maxPowerMW) => setForm({ ...form, maxPowerMW })}
              />
              <div className="col-span-2 text-[11px] text-muted-foreground">
                Use negative values for consuming benches. Example: a heat pump bench can be -3.0 to
                0.0 MW.
              </div>
              <div className="col-span-2">
                <Label className="text-[10px] uppercase tracking-wider">Compatible recipes</Label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {state.recipes.map((recipe) => (
                    <label
                      key={recipe.id}
                      className="flex items-center gap-2 rounded-sm border border-border bg-background/40 px-2 py-1 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={form.compatibleRecipeIds.includes(recipe.id)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            compatibleRecipeIds: e.target.checked
                              ? [...form.compatibleRecipeIds, recipe.id]
                              : form.compatibleRecipeIds.filter((id) => id !== recipe.id),
                          })
                        }
                      />
                      {recipe.name}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
          {["PV", "Generator"].includes(form.type) && (
            <NumberField
              label="Max generation MW"
              value={form.maxGenerationMW}
              onChange={(maxGenerationMW) => setForm({ ...form, maxGenerationMW })}
            />
          )}
          {["Load Bank", "Facility Load", "Cooling", "Compressed Air", "Fuel Supply"].includes(
            form.type,
          ) && (
            <NumberField
              label="Max consumption MW"
              value={form.maxConsumptionMW}
              onChange={(maxConsumptionMW) => setForm({ ...form, maxConsumptionMW })}
            />
          )}
          {form.type === "Battery" && (
            <>
              <NumberField
                label="Capacity MWh"
                value={form.batteryCapacityMWh}
                onChange={(batteryCapacityMWh) => setForm({ ...form, batteryCapacityMWh })}
              />
              <NumberField
                label="Max charge/discharge MW"
                value={form.maxChargeDischargeMW}
                onChange={(maxChargeDischargeMW) => setForm({ ...form, maxChargeDischargeMW })}
              />
              <NumberField
                label="State of charge %"
                value={form.batteryStateOfChargePercent}
                onChange={(batteryStateOfChargePercent) =>
                  setForm({ ...form, batteryStateOfChargePercent })
                }
              />
            </>
          )}
          {form.type === "Grid" && (
            <>
              <NumberField
                label="Max import MW"
                value={form.maxGridImportMW}
                onChange={(maxGridImportMW) => setForm({ ...form, maxGridImportMW })}
              />
              <NumberField
                label="Max export MW"
                value={form.maxGridExportMW}
                onChange={(maxGridExportMW) => setForm({ ...form, maxGridExportMW })}
              />
            </>
          )}
          <div className="col-span-2">
            <Label className="text-[10px] uppercase tracking-wider">Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>{isEdit ? "Save changes" : "Create resource"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider">{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
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
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
    </div>
  );
}
