import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Panel } from "@/components/ems/Panel";
import { ResourceDialog } from "@/components/ems/ResourceDialog";
import { useUtiliqStore } from "@/lib/utiliq-store";
import type { PlantResource } from "@/lib/utiliq-types";

export const Route = createFileRoute("/floor-layout")({
  head: () => ({
    meta: [
      { title: "Floor Layout - Utiliq" },
      {
        name: "description",
        content: "Isometric top-down schematic of plant resources on the factory floor.",
      },
    ],
  }),
  component: FloorLayoutPage,
});

// Isometric projection
const OX = 470;
const OY = 205;
const KX = 30;
const KY = 15;
const KZ = 24;
const p = (x: number, y: number, z: number) =>
  `${OX + (x - y) * KX},${OY + (x + y) * KY - z * KZ}`;

type Cuboid = { x: number; y: number; w: number; d: number; h: number };

// Where each resource sits on the floor (iso grid units).
const LAYOUT: Record<string, Cuboid> = {
  "TB-01": { x: 1, y: 0.6, w: 2, d: 1.4, h: 1.7 },
  "TB-03": { x: 1, y: 3.0, w: 2, d: 1.4, h: 1.7 },
  "TB-02": { x: 1, y: 5.2, w: 2, d: 1.4, h: 1.6 },
  "TB-04": { x: 4.4, y: 0.6, w: 2, d: 1.4, h: 1.6 },
  "TB-05": { x: 4.4, y: 3.0, w: 2, d: 1.4, h: 1.6 },
  "FUEL-01": { x: 8.4, y: 2.9, w: 1.3, d: 1.2, h: 1.3 },
  "PV-01": { x: 8.0, y: 0.6, w: 2.3, d: 1.4, h: 0.35 },
  "GRID-01": { x: 11.6, y: 0.8, w: 1.4, d: 1.2, h: 2.0 },
  "PV-02": { x: 11.3, y: 4.0, w: 2.3, d: 1.4, h: 0.35 },
  "GEN-01": { x: 1, y: 7.6, w: 1.6, d: 1.3, h: 1.7 },
  "BAT-01": { x: 3.3, y: 7.6, w: 1.4, d: 1.2, h: 1.2 },
  "LB-01": { x: 5.4, y: 7.6, w: 1.6, d: 1.2, h: 1.5 },
  "COOL-01": { x: 7.9, y: 7.6, w: 1.6, d: 1.2, h: 1.6 },
  "AIR-01": { x: 10.2, y: 7.6, w: 1.4, d: 1.2, h: 1.4 },
};

type Ramp = { t: string; r: string; f: string };
const RAMP: Record<string, Ramp> = {
  green: { t: "#97C459", r: "#639922", f: "#3B6D11" },
  red: { t: "#F09595", r: "#E24B4A", f: "#A32D2D" },
  gray: { t: "#D3D1C7", r: "#B4B2A9", f: "#7E7D77" },
  blue: { t: "#85B7EB", r: "#378ADD", f: "#185FA5" },
};

function FloorLayoutPage() {
  const { state, updateResource } = useUtiliqStore();
  const [editing, setEditing] = useState<PlantResource | null>(null);

  const production = state.resources
    .filter((resource) => resource.currentMW > 0)
    .reduce((sum, resource) => sum + resource.currentMW, 0);
  const consumption = state.resources
    .filter((resource) => resource.currentMW < 0)
    .reduce((sum, resource) => sum + Math.abs(resource.currentMW), 0);
  const net = production - consumption;

  const placed = state.resources
    .filter((resource) => LAYOUT[resource.id])
    .map((resource) => ({ resource, box: LAYOUT[resource.id] }))
    .sort((a, b) => a.box.x + a.box.y - (b.box.x + b.box.y));

  return (
    <div className="flex flex-col gap-3 p-3">
      <style>{`.iso-machine{cursor:pointer;transition:filter .12s ease}.iso-machine:hover{filter:brightness(1.08)}`}</style>

      <Panel contentClassName="flex flex-wrap items-center gap-3 p-3">
        <div className="px-2">
          <h1 className="text-sm font-semibold uppercase tracking-[0.14em]">Floor Layout</h1>
          <p className="text-[11px] text-muted-foreground">
            Isometric plant schematic · {placed.length} resources placed · click a machine to edit
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-5 text-right">
          <Metric label="Producing" value={`+${production.toFixed(1)} MW`} tone="production" />
          <Metric label="Consuming" value={`-${consumption.toFixed(1)} MW`} tone="consumption" />
          <Metric
            label="Net on bus"
            value={`${net >= 0 ? "+" : ""}${net.toFixed(1)} MW`}
            tone={net >= 0 ? "production" : "consumption"}
          />
          <Legend />
        </div>
      </Panel>

      <Panel title="Plant Floor" contentClassName="p-2">
        <svg viewBox="0 0 1000 700" width="100%" role="img" aria-label="Isometric factory floor plan">
          {/* back walls */}
          <polygon
            points={[p(0, 0, 0), p(0, 10, 0), p(0, 10, 2.4), p(0, 0, 2.4)].join(" ")}
            fill="#E7E5DD"
            stroke="rgba(20,20,18,.12)"
          />
          <polygon
            points={[p(0, 0, 0), p(16, 0, 0), p(16, 0, 2.4), p(0, 0, 2.4)].join(" ")}
            fill="#DEDCD3"
            stroke="rgba(20,20,18,.12)"
          />
          {/* floor + aisles */}
          <FloorTile x={0} y={0} w={16} d={10} fill="#ECEAE1" />
          <FloorTile x={0} y={6.9} w={16} d={0.7} fill="#F6F5F0" />
          <FloorTile x={7} y={0} w={0.7} d={10} fill="#F6F5F0" />
          {/* zone labels on the ground */}
          <GroundLabel at={p(3.4, 2.4, 0)} text="Test benches" />
          <GroundLabel at={p(6, 8.3, 0)} text="Utilities" />
          <GroundLabel at={p(12.4, 3, 0)} text="Grid / yard" />

          {/* machines, back-to-front */}
          {placed.map(({ resource, box }) => (
            <Machine
              key={resource.id}
              box={box}
              ramp={ramphFor(resource)}
              onClick={() => setEditing(resource)}
            />
          ))}

          {/* labels on top */}
          <g style={{ pointerEvents: "none" }}>
            {placed.map(({ resource, box }) => (
              <MachineLabel key={resource.id} resource={resource} box={box} />
            ))}
          </g>
        </svg>
      </Panel>

      <ResourceDialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        resource={editing}
        onSubmit={(patch) => {
          if (editing) updateResource(editing.id, patch);
          setEditing(null);
        }}
      />
    </div>
  );
}

function ramphFor(resource: PlantResource): Ramp {
  if (resource.type === "Grid") return RAMP.blue;
  if (resource.currentMW > 0.05) return RAMP.green;
  if (resource.currentMW < -0.05) return RAMP.red;
  return RAMP.gray;
}

function labelColorFor(resource: PlantResource): string {
  if (resource.currentMW > 0.05) return "var(--production)";
  if (resource.currentMW < -0.05) return "var(--consumption)";
  return "var(--muted-foreground)";
}

function FloorTile({
  x,
  y,
  w,
  d,
  fill,
}: {
  x: number;
  y: number;
  w: number;
  d: number;
  fill: string;
}) {
  return (
    <polygon
      points={[p(x, y, 0), p(x + w, y, 0), p(x + w, y + d, 0), p(x, y + d, 0)].join(" ")}
      fill={fill}
      stroke="rgba(20,20,18,.06)"
    />
  );
}

function Machine({ box, ramp, onClick }: { box: Cuboid; ramp: Ramp; onClick: () => void }) {
  const { x, y, w, d, h } = box;
  const edge = "rgba(20,20,18,.2)";
  return (
    <g className="iso-machine" onClick={onClick}>
      <polygon
        points={[p(x + w, y, h), p(x + w, y + d, h), p(x + w, y + d, 0), p(x + w, y, 0)].join(" ")}
        fill={ramp.r}
        stroke={edge}
        strokeWidth={1}
        strokeLinejoin="round"
      />
      <polygon
        points={[p(x, y + d, h), p(x + w, y + d, h), p(x + w, y + d, 0), p(x, y + d, 0)].join(" ")}
        fill={ramp.f}
        stroke={edge}
        strokeWidth={1}
        strokeLinejoin="round"
      />
      <polygon
        points={[p(x, y, h), p(x + w, y, h), p(x + w, y + d, h), p(x, y + d, h)].join(" ")}
        fill={ramp.t}
        stroke={edge}
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </g>
  );
}

function MachineLabel({ resource, box }: { resource: PlantResource; box: Cuboid }) {
  const [cx, cyRaw] = p(box.x + box.w / 2, box.y + box.d / 2, box.h).split(",").map(Number);
  const cy = cyRaw - 34;
  const mw = `${resource.currentMW > 0 ? "+" : ""}${resource.currentMW.toFixed(2)} MW`;
  const width = Math.max(resource.name.length * 6.2, mw.length * 7) + 18;
  return (
    <g>
      <rect
        x={cx - width / 2}
        y={cy - 14}
        width={width}
        height={34}
        rx={4}
        fill="var(--card)"
        stroke="var(--border)"
        strokeWidth={1}
      />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontSize={11.5}
        fontWeight={600}
        fill="var(--foreground)"
      >
        {resource.name}
      </text>
      <text
        x={cx}
        y={cy + 15}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize={12.5}
        fontWeight={600}
        fill={labelColorFor(resource)}
      >
        {mw}
      </text>
    </g>
  );
}

function GroundLabel({ at, text }: { at: string; text: string }) {
  const [x, y] = at.split(",").map(Number);
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontFamily="Inter, system-ui, sans-serif"
      fontSize={11}
      fontWeight={600}
      letterSpacing="0.12em"
      fill="rgba(90,90,86,.65)"
      style={{ textTransform: "uppercase", pointerEvents: "none" }}
    >
      {text}
    </text>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "production" | "consumption";
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div
        className={`font-mono text-xl font-semibold ${
          tone === "production" ? "text-production" : "text-consumption"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 border-l border-border pl-4 text-[10px] uppercase tracking-wider text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px] bg-production" /> Producing
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px] bg-consumption" /> Consuming
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px] bg-idle" /> Idle
      </span>
    </div>
  );
}
