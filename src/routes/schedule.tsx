import { createFileRoute } from "@tanstack/react-router";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  addDays,
  addMinutes,
  differenceInMinutes,
  format,
  isBefore,
  isSameDay,
  startOfDay,
} from "date-fns";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Lock, LockOpen, Pencil, Trash2, Zap } from "lucide-react";
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
import { nowIso } from "@/lib/clock";
import {
  assignmentDurationMinutes,
  calculateImpact,
  formatDateTime,
  formatDuration,
  formatTime,
  isBenchCompatible,
  parseDate,
  toIsoLocal,
  totalTestMinutes,
} from "@/lib/utiliq-engine";
import type { PlantResource, ScheduleAssignment, TestBench, TestItem } from "@/lib/utiliq-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/schedule")({
  head: () => ({
    meta: [
      { title: "Schedule - Utiliq" },
      {
        name: "description",
        content:
          "Test bench timeline with optimization impact and explainable schedule assignments.",
      },
    ],
  }),
  component: SchedulePage,
});

const START_HOUR = 6;
const END_HOUR = 21;
const DAY_MINUTES = (END_HOUR - START_HOUR) * 60;

// ─── Drop helpers ────────────────────────────────────────────────────────────

function cellId(benchId: string, day: Date) {
  return `cell|${benchId}|${format(day, "yyyy-MM-dd")}`;
}

function parseCellId(id: string): { benchId: string; dayDate: string } | null {
  const parts = id.split("|");
  if (parts.length !== 3 || parts[0] !== "cell") return null;
  return { benchId: parts[1], dayDate: parts[2] };
}

function calcDropStart(
  over: DragEndEvent["over"],
  active: DragEndEvent["active"],
  dayDate: string,
): string | null {
  if (!over || !active.rect.current.translated) return null;
  const relX = active.rect.current.translated.left - over.rect.left;
  const pct = Math.max(0, Math.min(0.97, relX / over.rect.width));
  const minuteOffset = Math.round((pct * DAY_MINUTES) / 30) * 30;
  const dayStart = parseDate(`${dayDate}T00:00:00`);
  return toIsoLocal(addMinutes(dayStart, START_HOUR * 60 + minuteOffset));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DroppableCell({
  id,
  children,
  height,
}: {
  id: string;
  children: React.ReactNode;
  height: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative border-r border-border last:border-r-0 transition-colors",
        isOver && "bg-primary/8",
      )}
      style={{ height }}
    >
      {children}
    </div>
  );
}

function DraggableAssignment({
  assignment,
  item,
  selected,
  left,
  width,
  onClick,
}: {
  assignment: ScheduleAssignment;
  item: TestItem | undefined;
  selected: boolean;
  left: number;
  width: number;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `asgn|${assignment.id}`,
    disabled: assignment.locked,
  });

  const tone =
    item?.status === "running"
      ? "running"
      : assignment.warnings?.some((w) => w.severity === "critical")
        ? "fault"
        : assignment.warnings?.length
          ? "warning"
          : "primary";

  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      style={{
        position: "absolute",
        top: 8,
        bottom: 8,
        left: `${left}%`,
        width: `${width}%`,
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 20 : selected ? 10 : undefined,
        touchAction: "none",
      }}
      className={cn(
        "overflow-hidden rounded-sm border px-2 py-1 text-left text-[10px] transition-shadow hover:shadow-md",
        selected && "ring-1 ring-primary",
        tone === "running" && "border-running/60 bg-running/15 text-running",
        tone === "fault" && "border-fault/60 bg-fault/15 text-fault",
        tone === "warning" && "border-warning/60 bg-warning/15 text-warning",
        tone === "primary" && "border-primary/50 bg-primary/15 text-primary",
      )}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-center gap-1.5">
        <StatusDot status={item?.status ?? "idle"} />
        <span className="font-mono">{formatTime(assignment.start)}</span>
        {assignment.locked && <Lock className="h-3 w-3" />}
        {!!assignment.warnings?.length && <AlertTriangle className="h-3 w-3" />}
      </div>
      <div className="mt-0.5 truncate font-medium text-foreground">{item?.serialNumber}</div>
      <div className="truncate opacity-75">{item?.modelName}</div>
    </button>
  );
}

function DraggableQueueCard({ item }: { item: TestItem }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `queue|${item.id}`,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
        touchAction: "none",
      }}
      className="rounded-sm border border-border bg-background/40 p-2 cursor-grab active:cursor-grabbing"
      {...listeners}
      {...attributes}
    >
      <div className="font-mono text-xs text-primary">{item.serialNumber}</div>
      <div className="mt-1 text-xs font-medium">{item.modelName}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {formatDateTime(item.deadline)} ·{" "}
        {formatDuration(Math.round(item.estimatedDurationHours * 60))}
      </div>
      <div className="mt-2">
        <span
          className={cn(
            "text-[10px] uppercase tracking-wider",
            item.priority === "urgent"
              ? "text-fault"
              : item.priority === "high"
                ? "text-warning"
                : "text-muted-foreground",
          )}
        >
          {item.priority}
        </span>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function SchedulePage() {
  const {
    state,
    autoScheduleItems,
    lockAssignment,
    removeAssignment,
    completeAssignment,
    createManualAssignment,
    moveAssignment,
    updateResource,
  } = useUtiliqStore();

  const [selectedId, setSelectedId] = useState<string | null>(state.assignments[0]?.id ?? null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [editingBench, setEditingBench] = useState<PlantResource | null>(null);

  const impact = useMemo(() => calculateImpact(state), [state]);
  const now = parseDate(nowIso());
  const start = startOfDay(now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  // "Now" line position within today
  const todayIndex = days.findIndex((d) => isSameDay(d, now));
  const nowMinutes = differenceInMinutes(now, addMinutes(start, START_HOUR * 60));
  const nowPct = Math.max(0, Math.min(100, (nowMinutes / DAY_MINUTES) * 100));

  const focusedBenchId =
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("bench");
  const focusedBench = focusedBenchId
    ? state.benches.find((b) => b.id === focusedBenchId)
    : undefined;

  const selected = state.assignments.find((a) => a.id === selectedId) ?? null;
  const selectedItem = selected
    ? state.testItems.find((item) => item.id === selected.testItemId)
    : null;

  const waiting = state.testItems
    .filter((item) => item.status === "waiting" || item.status === "delayed")
    .sort((a, b) => parseDate(a.deadline).getTime() - parseDate(b.deadline).getTime());

  // DnD sensors — require 8px movement so clicks still fire normally
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const cell = parseCellId(String(over.id));
    if (!cell) return;

    const startISO = calcDropStart(over, active, cell.dayDate);
    if (!startISO) return;

    const activeId = String(active.id);

    if (activeId.startsWith("asgn|")) {
      const assignmentId = activeId.slice(5);
      const assignment = state.assignments.find((a) => a.id === assignmentId);
      if (!assignment || assignment.locked) return;
      const item = state.testItems.find((i) => i.id === assignment.testItemId);
      if (!item) return;
      const bench = state.benches.find((b) => b.id === cell.benchId);
      if (!bench || !isBenchCompatible(item, bench)) return;
      const endISO = toIsoLocal(addMinutes(parseDate(startISO), totalTestMinutes(item)));
      moveAssignment(assignmentId, cell.benchId, startISO, endISO);
    } else if (activeId.startsWith("queue|")) {
      const itemId = activeId.slice(6);
      createManualAssignment(itemId, cell.benchId, startISO);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <Panel contentClassName="flex flex-wrap items-center gap-3 p-3">
        <div className="px-2">
          <h1 className="text-sm font-semibold uppercase tracking-[0.14em]">Schedule</h1>
          <p className="text-[11px] text-muted-foreground">
            7-day test bench plan · drag to reschedule · setup, test, cooldown, grid warnings
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => autoScheduleItems(waiting.map((item) => item.id))}
          >
            <Zap className="h-3.5 w-3.5" />
            Optimize waiting queue
          </Button>
        </div>
      </Panel>

      {focusedBench && (
        <Panel contentClassName="flex flex-wrap items-center gap-3 p-3">
          <div className="px-2">
            <div className="font-mono text-sm text-primary">{focusedBench.id}</div>
            <div className="text-xs text-muted-foreground">
              Focused from Live Energy · {focusedBench.name} · {focusedBench.status}
            </div>
          </div>
        </Panel>
      )}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-12 gap-3">
          {/* Unscheduled queue — draggable cards */}
          <Panel
            title="Unscheduled Queue"
            className="col-span-12 xl:col-span-2"
            contentClassName="space-y-2"
          >
            {waiting.map((item) => (
              <DraggableQueueCard key={item.id} item={item} />
            ))}
            {!waiting.length && (
              <div className="py-8 text-center text-xs text-muted-foreground">
                All ready units are scheduled.
              </div>
            )}
          </Panel>

          {/* Timeline */}
          <Panel
            title="Test Bench Timeline"
            className="col-span-12 xl:col-span-7"
            contentClassName="overflow-auto p-0"
          >
            <div className="min-w-[1180px]">
              {/* Header row */}
              <div
                className="grid border-b border-border"
                style={{ gridTemplateColumns: `110px repeat(${days.length}, minmax(140px, 1fr))` }}
              >
                <div className="border-r border-border bg-muted/40 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Bench
                </div>
                {days.map((day) => (
                  <div
                    key={day.toISOString()}
                    className="border-r border-border bg-muted/40 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground last:border-r-0"
                  >
                    {format(day, "EEE")}{" "}
                    <span className="font-mono text-foreground/80">{format(day, "dd.MM")}</span>
                  </div>
                ))}
              </div>

              {/* Bench rows */}
              {state.benches.map((bench) => (
                <div
                  key={bench.id}
                  className={cn(
                    "grid border-b border-border last:border-b-0",
                    focusedBenchId === bench.id && "bg-primary/5",
                  )}
                  style={{
                    gridTemplateColumns: `110px repeat(${days.length}, minmax(140px, 1fr))`,
                  }}
                >
                  <BenchHeader
                    bench={bench}
                    focused={focusedBenchId === bench.id}
                    onEdit={() => {
                      const resource = state.resources.find((r) => r.id === bench.id);
                      if (resource) setEditingBench(resource);
                    }}
                  />
                  {days.map((day, dayIndex) => {
                    const dayAssignments = state.assignments.filter(
                      (a) => a.benchId === bench.id && isSameDay(parseDate(a.start), day),
                    );
                    const isToday = dayIndex === todayIndex;
                    return (
                      <DroppableCell key={day.toISOString()} id={cellId(bench.id, day)} height={92}>
                        {/* Hour guide lines */}
                        {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => (
                          <div
                            key={i}
                            className="pointer-events-none absolute top-0 h-full border-l border-dashed border-border/40"
                            style={{ left: `${(i / (END_HOUR - START_HOUR)) * 100}%` }}
                          />
                        ))}
                        {/* "Now" indicator on today's column */}
                        {isToday && nowPct > 0 && (
                          <div
                            className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-fault/70"
                            style={{ left: `${nowPct}%` }}
                          >
                            <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-fault" />
                          </div>
                        )}
                        {/* Assignment blocks */}
                        {dayAssignments.map((assignment) => {
                          const item = state.testItems.find((t) => t.id === assignment.testItemId);
                          const startMinutes = Math.max(
                            0,
                            differenceInMinutes(
                              parseDate(assignment.start),
                              new Date(
                                day.getFullYear(),
                                day.getMonth(),
                                day.getDate(),
                                START_HOUR,
                              ),
                            ),
                          );
                          const width = Math.max(
                            8,
                            Math.min(
                              100 - (startMinutes / DAY_MINUTES) * 100,
                              (assignmentDurationMinutes(assignment) / DAY_MINUTES) * 100,
                            ),
                          );
                          const left = Math.min(96, (startMinutes / DAY_MINUTES) * 100);
                          return (
                            <DraggableAssignment
                              key={assignment.id}
                              assignment={assignment}
                              item={item}
                              selected={selectedId === assignment.id}
                              left={left}
                              width={width}
                              onClick={() => setSelectedId(assignment.id)}
                            />
                          );
                        })}
                      </DroppableCell>
                    );
                  })}
                </div>
              ))}

              {/* Hour labels */}
              <div
                className="grid border-t border-border"
                style={{ gridTemplateColumns: `110px repeat(${days.length}, minmax(140px, 1fr))` }}
              >
                <div className="border-r border-border bg-muted/20 px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Hours
                </div>
                {days.map((day) => (
                  <div
                    key={day.toISOString()}
                    className="relative border-r border-border bg-muted/20 last:border-r-0"
                    style={{ height: 20 }}
                  >
                    {[6, 9, 12, 15, 18, 21].map((hour) => (
                      <span
                        key={hour}
                        className="absolute top-1 font-mono text-[9px] text-muted-foreground"
                        style={{
                          left: `${((hour - START_HOUR) / (END_HOUR - START_HOUR)) * 100}%`,
                        }}
                      >
                        {String(hour).padStart(2, "0")}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          {/* Optimization impact + selected job */}
          <Panel title="Optimization Impact" className="col-span-12 xl:col-span-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Impact
                label="Estimated value"
                value={`€${Math.round(impact.estimatedSavingsEUR).toLocaleString("en-US")}`}
              />
              <Impact label="Curtailed energy" value={`${impact.curtailedMWh.toFixed(1)} MWh`} />
              <Impact
                label="Peak export"
                value={`${impact.peakExport.toFixed(1)} MW`}
                warn={impact.peakExport > state.energyConstraint.maxGridExportMW}
              />
              <Impact
                label="Peak import"
                value={`${impact.peakImport.toFixed(1)} MW`}
                warn={impact.peakImport > state.energyConstraint.maxGridImportMW}
              />
              <Impact
                label="Deadline misses"
                value={String(impact.deadlineViolations)}
                warn={impact.deadlineViolations > 0}
              />
              <Impact label="Bench utilization" value={`${impact.benchUtilization}%`} />
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Selected Job
              </h3>
              {selected && selectedItem ? (
                <div className="mt-3 space-y-3 text-sm">
                  <div>
                    <div className="font-mono text-primary">{selectedItem.serialNumber}</div>
                    <div className="text-xs text-muted-foreground">
                      {selectedItem.modelName} · {selected.benchId}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Impact label="Start" value={formatDateTime(selected.start)} />
                    <Impact label="End" value={formatDateTime(selected.end)} />
                  </div>
                  {!!selected.warnings?.length && (
                    <ul className="space-y-1 text-xs">
                      {selected.warnings.map((w) => (
                        <li key={`${w.type}-${w.message}`} className="text-warning">
                          - {w.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Why this slot?
                    </div>
                    <ul className="space-y-1 text-xs">
                      {(
                        selected.optimizationReason ?? [
                          "Manual assignment. Run optimizer to generate a stronger explanation.",
                        ]
                      ).map((reason) => (
                        <li key={reason}>- {reason}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => lockAssignment(selected.id, !selected.locked)}
                    >
                      {selected.locked ? (
                        <LockOpen className="h-3.5 w-3.5" />
                      ) : (
                        <Lock className="h-3.5 w-3.5" />
                      )}
                      {selected.locked ? "Unlock" : "Lock"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => completeAssignment(selected.id, "pass")}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Mark complete
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmRemoveId(selected.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-xs text-muted-foreground">
                  Select a schedule block to inspect the assignment.
                </div>
              )}
            </div>
          </Panel>
        </div>
      </DndContext>

      {/* Confirm remove assignment */}
      <AlertDialog open={!!confirmRemoveId} onOpenChange={() => setConfirmRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove assignment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will unschedule the test item and return it to the waiting queue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmRemoveId) {
                  removeAssignment(confirmRemoveId);
                  setSelectedId(null);
                }
                setConfirmRemoveId(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit bench resource dialog */}
      <ResourceDialog
        open={!!editingBench}
        onOpenChange={(open) => !open && setEditingBench(null)}
        resource={editingBench}
        onSubmit={(patch) => {
          if (editingBench) updateResource(editingBench.id, patch);
          setEditingBench(null);
        }}
      />
    </div>
  );
}

function BenchHeader({
  bench,
  focused,
  onEdit,
}: {
  bench: TestBench;
  focused: boolean;
  onEdit: () => void;
}) {
  return (
    <div
      className={cn(
        "group border-r border-border px-3 py-3",
        focused && "border-l-2 border-l-primary bg-primary/10",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="font-mono text-xs font-semibold">{bench.id}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {bench.benchType}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {bench.maxPowerMW.toFixed(1)} MW
          </div>
        </div>
        <button
          onClick={onEdit}
          className="mt-0.5 opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground/60 hover:text-foreground"
          title="Edit bench"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function Impact({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-sm border border-border bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-sm font-semibold", warn && "text-warning")}>
        {value}
      </div>
    </div>
  );
}
