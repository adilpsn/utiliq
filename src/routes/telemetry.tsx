import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Panel } from "@/components/ems/Panel";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { isLiveClock, nowIso } from "@/lib/clock";
import { collectorUrl, telemetryEnabled } from "@/lib/telemetry/flag";
import { useTelemetry } from "@/lib/telemetry/live-store";
import type { ConnectionState } from "@/lib/telemetry/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/telemetry")({
  component: TelemetryPage,
  head: () => ({
    meta: [
      { title: "Telemetry — Utiliq" },
      {
        name: "description",
        content: "Live sensor ingest status, tag mapping and unmapped topic diagnostics.",
      },
    ],
  }),
});

const STATE_LABEL: Record<ConnectionState, string> = {
  disabled: "Disabled",
  connecting: "Connecting",
  open: "Connected",
  retrying: "Reconnecting",
  error: "Error",
};

const STATE_TONE: Record<ConnectionState, string> = {
  disabled: "text-muted-foreground",
  connecting: "text-amber-500",
  open: "text-emerald-500",
  retrying: "text-amber-500",
  error: "text-red-500",
};

function ageSeconds(iso: string, now: number): number {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
}

function TelemetryPage() {
  const telemetry = useTelemetry();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!telemetryEnabled()) {
    return (
      <div className="p-6">
        <Panel title="Telemetry — disabled">
          <p className="text-sm text-muted-foreground">
            The v2 ingest pipeline is behind a feature flag so the demo build stays identical to{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">clickdummy-v1</code>.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-sm border border-border bg-muted/40 p-3 text-xs">
            {`# .env
VITE_TELEMETRY=1
VITE_COLLECTOR_URL=http://localhost:4000/stream

# then, in a second terminal:
node collector/index.mjs`}
          </pre>
        </Panel>
      </div>
    );
  }

  const { status, readings, sensors, unmapped, unparsable, staleSensorIds } = telemetry;
  const stale = new Set(staleSensorIds);
  const sensorById = new Map(sensors.map((s) => [s.id, s]));
  const active = Object.values(readings).sort((a, b) => a.sensorId.localeCompare(b.sensorId));

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <SidebarTrigger />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Telemetry</h1>
          <p className="text-xs text-muted-foreground">
            Ingest diagnostics · clock {isLiveClock() ? "live" : "pinned"} at {nowIso()}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className={cn("font-semibold", STATE_TONE[status.state])}>
            ● {STATE_LABEL[status.state]}
          </span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {collectorUrl()}
          </code>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <Panel title="Frames received">
          <p className="text-2xl font-semibold tabular-nums">{status.messagesReceived}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {status.lastMessageAt
              ? `last ${ageSeconds(status.lastMessageAt, now)}s ago`
              : "none yet"}
          </p>
        </Panel>
        <Panel title="Mapped sensors">
          <p className="text-2xl font-semibold tabular-nums">{active.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">of {sensors.length} configured</p>
        </Panel>
        <Panel title="Stale">
          <p
            className={cn(
              "text-2xl font-semibold tabular-nums",
              stale.size > 0 && "text-amber-500",
            )}
          >
            {stale.size}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">past their tolerance</p>
        </Panel>
        <Panel title="Unmapped topics">
          <p
            className={cn(
              "text-2xl font-semibold tabular-nums",
              unmapped.length > 0 && "text-amber-500",
            )}
          >
            {unmapped.length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">surfaced, never dropped</p>
        </Panel>
      </div>

      <Panel title="Live readings" contentClassName="p-0">
        {active.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No readings yet. Start the collector: <code>node collector/index.mjs</code>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Sensor</th>
                  <th className="px-4 py-2 text-left font-medium">Resource</th>
                  <th className="px-4 py-2 text-right font-medium">Value</th>
                  <th className="px-4 py-2 text-right font-medium">Raw</th>
                  <th className="px-4 py-2 text-right font-medium">Age</th>
                  <th className="px-4 py-2 text-left font-medium">Topic</th>
                </tr>
              </thead>
              <tbody>
                {active.map((reading) => {
                  const sensor = sensorById.get(reading.sensorId);
                  const isStaleRow = stale.has(reading.sensorId);
                  return (
                    <tr key={reading.sensorId} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2 font-mono text-xs">{reading.sensorId}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {sensor?.resourceId ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {reading.value.toFixed(3)}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {sensor?.unit ?? ""}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground tabular-nums">
                        {reading.rawValue ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span
                          className={cn(
                            "font-mono text-xs tabular-nums",
                            isStaleRow ? "text-amber-500" : "text-muted-foreground",
                          )}
                        >
                          {ageSeconds(reading.at, now)}s
                        </span>
                        {isStaleRow && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            stale
                          </Badge>
                        )}
                        {reading.quality === "error" && (
                          <Badge variant="destructive" className="ml-2 text-[10px]">
                            bad
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground">
                        {reading.source ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Unmapped topics (${unmapped.length})`} contentClassName="p-0">
          <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
            Seen on the wire, claimed by no mapping. Add a row to <code>DEFAULT_MAPPINGS</code> to
            bind these.
          </p>
          {unmapped.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Everything mapped.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {unmapped.map((entry) => (
                <li key={entry.topic} className="border-b border-border/60 px-4 py-2 last:border-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <code className="font-mono text-xs">{entry.topic}</code>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      ×{entry.count}
                    </span>
                  </div>
                  <code className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                    {entry.samplePayload}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Unparsable payloads (${unparsable.length})`} contentClassName="p-0">
          <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
            Arrived, but yielded no number. Usually status strings — confirm whether they matter.
          </p>
          {unparsable.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">All payloads parsed.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {unparsable.map((entry) => (
                <li key={entry.topic} className="border-b border-border/60 px-4 py-2 last:border-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <code className="font-mono text-xs">{entry.topic}</code>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      ×{entry.count}
                    </span>
                  </div>
                  <code className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                    {entry.samplePayload}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Active assumptions — confirm each at 2G" contentClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Pattern</th>
                <th className="px-4 py-2 text-right font-medium">Scale</th>
                <th className="px-4 py-2 text-center font-medium">Invert</th>
                <th className="px-4 py-2 text-left font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {telemetry.mappings.map((mapping) => (
                <tr key={mapping.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{mapping.pattern}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                    {mapping.scale}
                  </td>
                  <td className="px-4 py-2 text-center text-xs">{mapping.invert ? "yes" : "no"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{mapping.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
