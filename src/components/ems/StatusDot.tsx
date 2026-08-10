import { cn } from "@/lib/utils";
import type { Status } from "@/lib/mock-data";

const colorByStatus: Record<string, string> = {
  running: "bg-production shadow-[0_0_8px_var(--color-production)]",
  exporting: "bg-production shadow-[0_0_8px_var(--color-production)]",
  generating: "bg-production shadow-[0_0_8px_var(--color-production)]",
  discharging: "bg-production shadow-[0_0_8px_var(--color-production)]",
  charging: "bg-consumption shadow-[0_0_8px_var(--color-consumption)]",
  importing: "bg-consumption shadow-[0_0_8px_var(--color-consumption)]",
  warning: "bg-warning",
  standby: "bg-warning",
  fault: "bg-fault",
  stopped: "bg-idle",
  idle: "bg-idle",
};

export function StatusDot({ status, className }: { status: Status | string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        colorByStatus[status] ?? "bg-idle",
        className,
      )}
    />
  );
}

export function StatusLabel({ status }: { status: Status | string }) {
  const color =
    status === "running" ||
    status === "exporting" ||
    status === "generating" ||
    status === "discharging"
      ? "text-production"
      : status === "importing" || status === "charging"
        ? "text-consumption"
        : status === "warning" || status === "standby"
          ? "text-warning"
          : status === "fault"
            ? "text-fault"
            : "text-muted-foreground";
  return (
    <span className={cn("text-[10px] font-medium uppercase tracking-wider", color)}>{status}</span>
  );
}
