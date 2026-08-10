import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { collectorUrl, telemetryEnabled } from "./flag";
import {
  DEFAULT_MAPPINGS,
  DEFAULT_SENSORS,
  applyMapping,
  isStale,
  resolveMapping,
} from "./mapping";
import { parsePayload } from "./parse";
import { connectCollector } from "./transport";
import type {
  ConnectionStatus,
  Reading,
  Sensor,
  TagMapping,
  UnmappedTopic,
  WireFrame,
} from "./types";

/**
 * Live telemetry state.
 *
 * Held SEPARATELY from UtiliqStoreProvider on purpose. The main store
 * JSON-stringifies its entire state into localStorage on every change
 * (utiliq-store.tsx), so routing a live feed through it would (a) write
 * megabytes per minute, (b) blow the ~5 MB quota, and (c) re-run the O(n²)
 * warning engine on every single message. Live values are ephemeral: they
 * belong in memory and nowhere else.
 *
 * Ingest is COALESCED, not applied per message. Frames land in a ref-held
 * buffer and are flushed once per FLUSH_MS into a single setState, so a
 * thousand messages a second still cost React one render every 250 ms.
 */

const FLUSH_MS = 250;
const MAX_UNMAPPED = 200;

export type TelemetryValue = {
  enabled: boolean;
  status: ConnectionStatus;
  /** Latest reading per sensor id. */
  readings: Record<string, Reading>;
  sensors: Sensor[];
  mappings: TagMapping[];
  /** Topics seen on the wire that no mapping claimed. Never silently dropped. */
  unmapped: UnmappedTopic[];
  /** Payloads that arrived but yielded no numeric sample. */
  unparsable: UnmappedTopic[];
  /** Reading for a resource id, if any sensor maps to it. */
  readingForResource: (resourceId: string) => Reading | undefined;
  staleSensorIds: string[];
  /** Inject frames directly — used by tests and the in-app simulator. */
  ingest: (frames: WireFrame[]) => void;
};

const TelemetryContext = createContext<TelemetryValue | null>(null);

const emptyStatus = (url: string, state: ConnectionStatus["state"]): ConnectionStatus => ({
  state,
  url,
  since: new Date().toISOString(),
  messagesReceived: 0,
});

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const enabled = telemetryEnabled();
  const url = collectorUrl();

  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [unmapped, setUnmapped] = useState<Record<string, UnmappedTopic>>({});
  const [unparsable, setUnparsable] = useState<Record<string, UnmappedTopic>>({});
  const [status, setStatus] = useState<ConnectionStatus>(() =>
    emptyStatus(url, enabled ? "connecting" : "disabled"),
  );

  const sensors = DEFAULT_SENSORS;
  const mappings = DEFAULT_MAPPINGS;

  // Buffers. Refs, not state — writing here must never trigger a render.
  const frameBuffer = useRef<WireFrame[]>([]);
  const receivedCount = useRef(0);

  const ingest = useCallback((frames: WireFrame[]) => {
    frameBuffer.current.push(...frames);
    receivedCount.current += frames.length;
  }, []);

  // --- flush loop ----------------------------------------------------------
  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(() => {
      const batch = frameBuffer.current;
      if (batch.length === 0) return;
      frameBuffer.current = [];

      const nextReadings: Record<string, Reading> = {};
      const nextUnmapped: Record<string, UnmappedTopic> = {};
      const nextUnparsable: Record<string, UnmappedTopic> = {};
      let lastMessageAt: string | undefined;

      for (const frame of batch) {
        lastMessageAt = frame.receivedAt;
        const samples = parsePayload(frame.payload);

        if (samples.length === 0) {
          const prev = nextUnparsable[frame.topic];
          nextUnparsable[frame.topic] = {
            topic: frame.topic,
            samplePayload: frame.payload.slice(0, 200),
            count: (prev?.count ?? 0) + 1,
            firstSeen: prev?.firstSeen ?? frame.receivedAt,
            lastSeen: frame.receivedAt,
          };
          continue;
        }

        for (const sample of samples) {
          const resolved = resolveMapping(frame.topic, sample.subKey, mappings);
          if (!resolved) {
            const address = sample.subKey ? `${frame.topic}/${sample.subKey}` : frame.topic;
            const prev = nextUnmapped[address];
            nextUnmapped[address] = {
              topic: address,
              samplePayload: frame.payload.slice(0, 200),
              count: (prev?.count ?? 0) + 1,
              firstSeen: prev?.firstSeen ?? frame.receivedAt,
              lastSeen: frame.receivedAt,
            };
            continue;
          }

          const reading = applyMapping(
            sample,
            resolved.mapping,
            resolved.segments,
            frame.receivedAt,
          );
          const existing = nextReadings[reading.sensorId];
          // Out-of-order delivery is normal on QoS 0. Keep the newest by
          // timestamp rather than by arrival, so a late duplicate cannot
          // overwrite a fresher value.
          if (!existing || new Date(reading.at) >= new Date(existing.at)) {
            nextReadings[reading.sensorId] = { ...reading, source: frame.topic };
          }
        }
      }

      if (Object.keys(nextReadings).length > 0) {
        setReadings((prev) => {
          const merged = { ...prev };
          for (const [id, reading] of Object.entries(nextReadings)) {
            const existing = merged[id];
            if (!existing || new Date(reading.at) >= new Date(existing.at)) merged[id] = reading;
          }
          return merged;
        });
      }

      const mergeSeen = (setter: typeof setUnmapped, incoming: Record<string, UnmappedTopic>) => {
        if (Object.keys(incoming).length === 0) return;
        setter((prev) => {
          const merged = { ...prev };
          for (const [key, entry] of Object.entries(incoming)) {
            const existing = merged[key];
            merged[key] = existing
              ? {
                  ...entry,
                  count: existing.count + entry.count,
                  firstSeen: existing.firstSeen,
                }
              : entry;
          }
          // Bound the tray: a wildcard subscription on a busy broker can see
          // thousands of distinct topics, and this is a diagnostic, not a log.
          const keys = Object.keys(merged);
          if (keys.length <= MAX_UNMAPPED) return merged;
          const trimmed: Record<string, UnmappedTopic> = {};
          for (const key of keys
            .sort((a, b) => merged[b].count - merged[a].count)
            .slice(0, MAX_UNMAPPED)) {
            trimmed[key] = merged[key];
          }
          return trimmed;
        });
      };

      mergeSeen(setUnmapped, nextUnmapped);
      mergeSeen(setUnparsable, nextUnparsable);

      setStatus((prev) => ({
        ...prev,
        messagesReceived: receivedCount.current,
        lastMessageAt: lastMessageAt ?? prev.lastMessageAt,
      }));
    }, FLUSH_MS);

    return () => clearInterval(timer);
  }, [enabled, mappings]);

  // --- transport -----------------------------------------------------------
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const disconnect = connectCollector(url, {
      onFrames: ingest,
      onState: (state, error) =>
        setStatus((prev) => ({
          ...prev,
          state,
          lastError: error ?? prev.lastError,
          since: state === "open" ? new Date().toISOString() : prev.since,
        })),
    });

    return disconnect;
  }, [enabled, url, ingest]);

  // --- staleness -----------------------------------------------------------
  // A dead sensor must not look identical to a healthy one holding steady.
  const [staleTick, setStaleTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setStaleTick((n) => n + 1), 5000);
    return () => clearInterval(timer);
  }, [enabled]);

  const sensorById = useMemo(() => new Map(sensors.map((s) => [s.id, s])), [sensors]);

  const staleSensorIds = useMemo(() => {
    void staleTick;
    const now = new Date();
    return Object.values(readings)
      .filter((reading) => isStale(reading, sensorById.get(reading.sensorId), now))
      .map((reading) => reading.sensorId);
  }, [readings, sensorById, staleTick]);

  const byResource = useMemo(() => {
    const map = new Map<string, Reading>();
    for (const sensor of sensors) {
      if (!sensor.resourceId || sensor.measurement !== "power") continue;
      const reading = readings[sensor.id];
      if (reading) map.set(sensor.resourceId, reading);
    }
    return map;
  }, [readings, sensors]);

  const value = useMemo<TelemetryValue>(
    () => ({
      enabled,
      status,
      readings,
      sensors,
      mappings,
      unmapped: Object.values(unmapped).sort((a, b) => b.count - a.count),
      unparsable: Object.values(unparsable).sort((a, b) => b.count - a.count),
      readingForResource: (resourceId: string) => byResource.get(resourceId),
      staleSensorIds,
      ingest,
    }),
    [
      enabled,
      status,
      readings,
      sensors,
      mappings,
      unmapped,
      unparsable,
      byResource,
      staleSensorIds,
      ingest,
    ],
  );

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

export function useTelemetry(): TelemetryValue {
  const context = useContext(TelemetryContext);
  if (!context) throw new Error("useTelemetry must be used within TelemetryProvider");
  return context;
}
