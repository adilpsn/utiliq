import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip } from "recharts";
import { CalendarPlus, ClipboardList, Edit, Search, Trash2, Zap } from "lucide-react";
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
import { StatusDot } from "@/components/ems/StatusDot";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useUtiliqStore } from "@/lib/utiliq-store";
import { formatDate, formatDateTime, formatDuration, totalTestMinutes } from "@/lib/utiliq-engine";
import type { Priority, TestItem } from "@/lib/utiliq-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/queue")({
  head: () => ({
    meta: [
      { title: "Production Queue - Utiliq" },
      {
        name: "description",
        content: "Production-ready units waiting for high-power test scheduling.",
      },
    ],
  }),
  component: ProductionQueuePage,
});

const statuses = [
  "all",
  "waiting",
  "scheduled",
  "running",
  "completed",
  "failed",
  "delayed",
] as const;
const priorities = ["all", "urgent", "high", "normal", "low"] as const;

type ItemForm = {
  serialNumber: string;
  modelNumber: string;
  modelName: string;
  customerName: string;
  orderId: string;
  dateManufactured: string;
  readyForTestDate: string;
  deadline: string;
  priority: Priority;
  testRecipeId: string;
  estimatedDurationHours: number;
  setupTimeMinutes: number;
  cooldownTimeMinutes: number;
  notes: string;
};

function ProductionQueuePage() {
  const { state, addItem, updateItem, deleteItem, autoScheduleItems } = useUtiliqStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof statuses)[number]>("all");
  const [priority, setPriority] = useState<(typeof priorities)[number]>("all");
  const [recipeFilter, setRecipeFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeItem, setActiveItem] = useState<TestItem | null>(null);
  const [editing, setEditing] = useState<TestItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const rows = useMemo(() => {
    return [...state.testItems]
      .filter((item) => {
        const haystack = [
          item.serialNumber,
          item.modelName,
          item.modelNumber,
          item.customerName,
          item.orderId,
        ]
          .join(" ")
          .toLowerCase();
        if (query && !haystack.includes(query.toLowerCase())) return false;
        if (status !== "all" && item.status !== status) return false;
        if (priority !== "all" && item.priority !== priority) return false;
        if (recipeFilter !== "all" && item.testRecipeId !== recipeFilter) return false;
        return true;
      })
      .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  }, [state.testItems, query, status, priority, recipeFilter]);

  const selectedWaiting = selectedIds.filter((id) => {
    const item = state.testItems.find((candidate) => candidate.id === id);
    return item && (item.status === "waiting" || item.status === "delayed");
  });

  const toggleSelected = (itemId: string) => {
    setSelectedIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId],
    );
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <Panel contentClassName="flex flex-wrap items-center gap-3 p-3">
        <div className="px-2">
          <h1 className="text-sm font-semibold uppercase tracking-[0.14em]">Production Queue</h1>
          <p className="text-[11px] text-muted-foreground">
            {rows.length} test items · {selectedWaiting.length} selected for scheduling
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <CalendarPlus className="h-3.5 w-3.5" />
            Add item
          </Button>
          <Button
            size="sm"
            disabled={!selectedWaiting.length}
            onClick={() => autoScheduleItems(selectedWaiting)}
          >
            <Zap className="h-3.5 w-3.5" />
            Auto schedule selected
          </Button>
        </div>
      </Panel>

      <Panel contentClassName="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-72 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search serial, model, customer, order"
            className="pl-7"
          />
        </div>
        <FilterSelect
          value={status}
          onChange={(value) => setStatus(value as typeof status)}
          values={statuses}
        />
        <FilterSelect
          value={priority}
          onChange={(value) => setPriority(value as typeof priority)}
          values={priorities}
        />
        <Select value={recipeFilter} onValueChange={setRecipeFilter}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Recipe" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All recipes</SelectItem>
            {state.recipes.map((recipe) => (
              <SelectItem key={recipe.id} value={recipe.id}>
                {recipe.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Panel>

      <Panel title="Production-Ready Units" contentClassName="overflow-auto p-0">
        <table className="w-full min-w-[1180px] text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="w-10 px-4 py-2 text-left font-medium"></th>
              <th className="px-4 py-2 text-left font-medium">Serial No.</th>
              <th className="px-4 py-2 text-left font-medium">Model</th>
              <th className="px-4 py-2 text-left font-medium">Customer / Order</th>
              <th className="px-4 py-2 text-left font-medium">Ready</th>
              <th className="px-4 py-2 text-left font-medium">Required Test</th>
              <th className="px-4 py-2 text-right font-medium">Duration</th>
              <th className="px-4 py-2 text-left font-medium">Deadline</th>
              <th className="px-4 py-2 text-left font-medium">Priority</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Assigned Slot</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const recipe = state.recipes.find((candidate) => candidate.id === item.testRecipeId);
              const assignment = state.assignments.find(
                (candidate) => candidate.testItemId === item.id,
              );
              return (
                <tr key={item.id} className="border-b border-border/60 hover:bg-accent/30">
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelected(item.id)}
                      disabled={!["waiting", "delayed"].includes(item.status)}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      className="font-mono text-xs text-primary hover:underline"
                      onClick={() => setActiveItem(item)}
                    >
                      {item.serialNumber}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{item.modelName}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {item.modelNumber}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div>{item.customerName}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {item.orderId}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {formatDate(item.readyForTestDate)}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{recipe?.name}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">
                    {formatDuration(totalTestMinutes(item))}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{formatDateTime(item.deadline)}</td>
                  <td className="px-4 py-2.5">
                    <PriorityBadge priority={item.priority} />
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {assignment ? (
                      <span className="font-mono">
                        {assignment.benchId} · {formatDateTime(assignment.start)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Unscheduled</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setEditing(item)}>
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setConfirmDeleteId(item.id)}
                        disabled={item.status === "running"}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <ItemDetail item={activeItem} onClose={() => setActiveItem(null)} />
      <ItemFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(form) => addItem({ ...form, status: "waiting" })}
      />
      <ItemFormDialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        item={editing}
        onSubmit={(form) => {
          if (editing) {
            const recipe = state.recipes.find((candidate) => candidate.id === form.testRecipeId);
            const compatibleBenchIds = recipe
              ? state.benches
                  .filter((bench) => bench.compatibleRecipeIds?.includes(recipe.id))
                  .map((bench) => bench.id)
              : editing.compatibleBenchIds;
            updateItem(editing.id, {
              ...form,
              expectedPowerProfile: recipe?.expectedPowerProfile ?? editing.expectedPowerProfile,
              compatibleBenchIds,
            });
          }
          setEditing(null);
        }}
      />

      <AlertDialog open={!!confirmDeleteId} onOpenChange={() => setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete test item?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const item = state.testItems.find((i) => i.id === confirmDeleteId);
                return item
                  ? `${item.serialNumber} — ${item.modelName} will be permanently removed from the queue.`
                  : "This item will be permanently removed.";
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDeleteId) deleteItem(confirmDeleteId);
                setConfirmDeleteId(null);
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

function FilterSelect({
  value,
  values,
  onChange,
}: {
  value: string;
  values: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {values.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={cn(
        "rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        priority === "urgent"
          ? "border-fault/40 bg-fault/10 text-fault"
          : priority === "high"
            ? "border-warning/40 bg-warning/10 text-warning"
            : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: TestItem["status"] }) {
  return (
    <span className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider">
      <StatusDot
        status={
          status === "completed"
            ? "running"
            : status === "failed"
              ? "fault"
              : status === "delayed"
                ? "warning"
                : status
        }
      />
      {status}
    </span>
  );
}

function ItemDetail({ item, onClose }: { item: TestItem | null; onClose: () => void }) {
  const { state } = useUtiliqStore();
  const recipe = item
    ? state.recipes.find((candidate) => candidate.id === item.testRecipeId)
    : undefined;
  const assignment = item
    ? state.assignments.find((candidate) => candidate.testItemId === item.id)
    : undefined;
  const record = item
    ? state.records.find((candidate) => candidate.testItemId === item.id)
    : undefined;
  const profile =
    item?.expectedPowerProfile.map((point) => ({
      minute: point.offsetMinutes,
      mw: point.powerMW,
    })) ?? [];

  return (
    <Sheet open={!!item} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[480px] bg-panel sm:max-w-[480px]">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono text-sm">{item.serialNumber}</SheetTitle>
              <SheetDescription>
                {item.modelName} · {item.customerName}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-5 px-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Detail label="Order" value={item.orderId ?? "-"} mono />
                <Detail label="Priority" value={item.priority} />
                <Detail label="Ready" value={formatDate(item.readyForTestDate)} mono />
                <Detail label="Deadline" value={formatDateTime(item.deadline)} mono />
                <Detail label="Recipe" value={recipe?.name ?? "-"} />
                <Detail
                  label="Compatible benches"
                  value={item.compatibleBenchIds.join(", ")}
                  mono
                />
              </div>
              <Panel title="Expected Power Profile">
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={profile}>
                      <XAxis
                        dataKey="minute"
                        tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                        width={32}
                      />
                      <RTooltip
                        contentStyle={{
                          background: "var(--color-panel)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 2,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="mw" fill="var(--color-primary)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
              <Panel title="Scheduling Status">
                {assignment ? (
                  <div className="space-y-2 text-xs">
                    <Detail label="Bench" value={assignment.benchId} mono />
                    <Detail
                      label="Slot"
                      value={`${formatDateTime(assignment.start)} - ${formatDateTime(assignment.end)}`}
                      mono
                    />
                    <div className="pt-2">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        Why this slot?
                      </div>
                      <ul className="space-y-1">
                        {(assignment.optimizationReason ?? []).map((reason) => (
                          <li key={reason}>- {reason}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No schedule assignment yet.</div>
                )}
              </Panel>
              <Panel title="Notes">
                <p className="text-xs text-muted-foreground">
                  {item.notes || "No notes recorded."}
                </p>
              </Panel>
              {record && (
                <Panel title="Test History">
                  <p className="text-xs">
                    Recorded outcome: <span className="uppercase">{record.outcome}</span> ·{" "}
                    {formatDateTime(record.actualEnd ?? record.scheduledEnd)}
                  </p>
                </Panel>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-b border-border pb-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-sm", mono && "font-mono text-xs")}>{value}</div>
    </div>
  );
}

function ItemFormDialog({
  open,
  onOpenChange,
  item,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: TestItem | null;
  onSubmit: (form: ItemForm) => void;
}) {
  const { state } = useUtiliqStore();
  const firstRecipe = state.recipes[0];
  const [form, setForm] = useState<ItemForm>(() => ({
    serialNumber: item?.serialNumber ?? `UTQ-2026-${Math.floor(Math.random() * 800 + 1200)}`,
    modelNumber: item?.modelNumber ?? "AG408",
    modelName: item?.modelName ?? "Agenitor 408 CHP Unit",
    customerName: item?.customerName ?? "2G Energy",
    orderId: item?.orderId ?? "2G-NEW",
    dateManufactured: item?.dateManufactured ?? "2026-06-02",
    readyForTestDate: item?.readyForTestDate ?? "2026-06-03",
    deadline: item?.deadline ?? "2026-06-09T16:00",
    priority: item?.priority ?? "normal",
    testRecipeId: item?.testRecipeId ?? firstRecipe.id,
    estimatedDurationHours: item?.estimatedDurationHours ?? firstRecipe.defaultDurationHours,
    setupTimeMinutes: item?.setupTimeMinutes ?? firstRecipe.setupTimeMinutes,
    cooldownTimeMinutes: item?.cooldownTimeMinutes ?? firstRecipe.cooldownTimeMinutes,
    notes: item?.notes ?? "",
  }));

  useEffect(() => {
    if (!open) return;
    setForm({
      // For new items keep the serial blank so the user always types it.
      // For edits, preserve the existing serial.
      serialNumber: item?.serialNumber ?? "",
      modelNumber: item?.modelNumber ?? "AG408",
      modelName: item?.modelName ?? "Agenitor 408 CHP Unit",
      customerName: item?.customerName ?? "2G Energy",
      orderId: item?.orderId ?? "2G-NEW",
      dateManufactured: item?.dateManufactured ?? "2026-06-02",
      readyForTestDate: item?.readyForTestDate ?? "2026-06-03",
      deadline: item?.deadline?.slice(0, 16) ?? "2026-06-09T16:00",
      priority: item?.priority ?? "normal",
      testRecipeId: item?.testRecipeId ?? firstRecipe.id,
      estimatedDurationHours: item?.estimatedDurationHours ?? firstRecipe.defaultDurationHours,
      setupTimeMinutes: item?.setupTimeMinutes ?? firstRecipe.setupTimeMinutes,
      cooldownTimeMinutes: item?.cooldownTimeMinutes ?? firstRecipe.cooldownTimeMinutes,
      notes: item?.notes ?? "",
    });
  }, [open, item, firstRecipe.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-panel">
        <DialogHeader>
          <DialogTitle>{item ? "Edit test item" : "Add production test item"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <Field
            id="serial"
            label="Serial No."
            value={form.serialNumber}
            onChange={(value) => setForm({ ...form, serialNumber: value })}
          />
          <Field
            id="order"
            label="Order ID"
            value={form.orderId}
            onChange={(value) => setForm({ ...form, orderId: value })}
          />
          <Field
            id="model"
            label="Model Name"
            value={form.modelName}
            onChange={(value) => setForm({ ...form, modelName: value })}
          />
          <Field
            id="modelNo"
            label="Model No."
            value={form.modelNumber}
            onChange={(value) => setForm({ ...form, modelNumber: value })}
          />
          <Field
            id="customer"
            label="Customer"
            value={form.customerName}
            onChange={(value) => setForm({ ...form, customerName: value })}
          />
          <div>
            <Label className="text-[10px] uppercase tracking-wider">Recipe</Label>
            <Select
              value={form.testRecipeId}
              onValueChange={(testRecipeId) => {
                const recipe = state.recipes.find((candidate) => candidate.id === testRecipeId);
                setForm({
                  ...form,
                  testRecipeId,
                  estimatedDurationHours:
                    recipe?.defaultDurationHours ?? form.estimatedDurationHours,
                  setupTimeMinutes: recipe?.setupTimeMinutes ?? form.setupTimeMinutes,
                  cooldownTimeMinutes: recipe?.cooldownTimeMinutes ?? form.cooldownTimeMinutes,
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {state.recipes.map((recipe) => (
                  <SelectItem key={recipe.id} value={recipe.id}>
                    {recipe.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field
            id="duration"
            label="Test duration hours"
            type="number"
            value={String(form.estimatedDurationHours)}
            onChange={(value) => setForm({ ...form, estimatedDurationHours: Number(value) || 0 })}
          />
          <Field
            id="setup"
            label="Setup minutes"
            type="number"
            value={String(form.setupTimeMinutes)}
            onChange={(value) =>
              setForm({ ...form, setupTimeMinutes: Math.max(0, Math.round(Number(value) || 0)) })
            }
          />
          <Field
            id="cooldown"
            label="Cooldown minutes"
            type="number"
            value={String(form.cooldownTimeMinutes)}
            onChange={(value) =>
              setForm({ ...form, cooldownTimeMinutes: Math.max(0, Math.round(Number(value) || 0)) })
            }
          />
          <Field
            id="made"
            label="Date Manufactured"
            type="date"
            value={form.dateManufactured}
            onChange={(value) => setForm({ ...form, dateManufactured: value })}
          />
          <Field
            id="ready"
            label="Ready Date"
            type="date"
            value={form.readyForTestDate}
            onChange={(value) => setForm({ ...form, readyForTestDate: value })}
          />
          <Field
            id="deadline"
            label="Deadline"
            type="datetime-local"
            value={form.deadline}
            onChange={(value) => setForm({ ...form, deadline: value })}
          />
          <div>
            <Label className="text-[10px] uppercase tracking-wider">Priority</Label>
            <Select
              value={form.priority}
              onValueChange={(value) => setForm({ ...form, priority: value as Priority })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["low", "normal", "high", "urgent"] as const).map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-[10px] uppercase tracking-wider">Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSubmit({
                ...form,
                deadline: form.deadline.length === 16 ? `${form.deadline}:00` : form.deadline,
              });
              onOpenChange(false);
            }}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            Save item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-[10px] uppercase tracking-wider">
        {label}
      </Label>
      <Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
