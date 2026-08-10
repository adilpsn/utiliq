import type { WireFrame } from "./types";

/**
 * Browser-side transport.
 *
 * The app talks to the COLLECTOR over Server-Sent Events, never to the broker.
 * That decision deliberately sidesteps the three biggest unknowns before the
 * site visit:
 *
 *   1. Whether 2G's broker exposes MQTT over WebSocket. A browser cannot open a
 *      raw TCP MQTT connection; if there is no wss:// listener, an in-app client
 *      is impossible. With a collector it never matters.
 *   2. Whether the app is deployed to Cloudflare Workers, which are
 *      request-scoped and cannot hold a persistent subscriber.
 *   3. Whether the broker is reachable only from the plant network — the
 *      collector can run at the edge and push outward.
 *
 * SSE over WebSocket is chosen on purpose: the flow is one-directional, SSE
 * reconnects on its own, and it survives proxies that mangle WebSocket upgrades
 * (common on industrial networks).
 */

export type TransportEvents = {
  onFrames: (frames: WireFrame[]) => void;
  onState: (state: "connecting" | "open" | "retrying" | "error", error?: string) => void;
};

const MAX_BACKOFF_MS = 15_000;

export function connectCollector(url: string, events: TransportEvents): () => void {
  let source: EventSource | null = null;
  let closed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (closed) return;
    events.onState(attempt === 0 ? "connecting" : "retrying");

    try {
      source = new EventSource(url);
    } catch (error) {
      events.onState("error", error instanceof Error ? error.message : String(error));
      scheduleRetry();
      return;
    }

    source.onopen = () => {
      attempt = 0;
      events.onState("open");
    };

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as WireFrame | WireFrame[];
        events.onFrames(Array.isArray(parsed) ? parsed : [parsed]);
      } catch {
        // A single malformed frame must never kill the stream.
      }
    };

    source.onerror = () => {
      // EventSource retries by itself, but without backoff and without telling
      // us why. Take control so a collector that is down does not become a
      // tight reconnect loop against the plant network.
      source?.close();
      source = null;
      events.onState("retrying");
      scheduleRetry();
    };
  };

  const scheduleRetry = () => {
    if (closed) return;
    attempt += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(attempt, 5));
    retryTimer = setTimeout(open, delay);
  };

  open();

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    source?.close();
    source = null;
  };
}
