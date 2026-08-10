import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/**
 * Frame sources for the collector.
 *
 * Both sources emit the same thing: { topic, payload, receivedAt }. The
 * collector does NOT interpret payloads — parsing lives in exactly one place
 * (src/lib/telemetry/parse.ts) so a wrong assumption about the wire format is
 * fixed once, not twice.
 */

/**
 * Replay a captured topic dump.
 *
 * Feed it the output of:
 *   mosquitto_sub -h <host> -t '#' -v > 2g_topics.txt
 *
 * `-v` prints "<topic> <payload>" per line, which is exactly this format. That
 * is the point: tomorrow's capture becomes tonight's test fixture with no
 * conversion step, and the whole pipeline can be exercised without touching
 * 2G's network.
 *
 * Lines starting with # are comments. Blank lines are ignored.
 */
export function replaySource({ file, intervalMs = 1000, loop = true, onFrame, onLog }) {
  let stopped = false;
  let timer;

  const load = async () => {
    const lines = [];
    const stream = createInterface({
      input: createReadStream(file),
      crlfDelay: Infinity,
    });
    for await (const line of stream) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const spaceAt = trimmed.indexOf(" ");
      if (spaceAt === -1) continue;
      lines.push({
        topic: trimmed.slice(0, spaceAt),
        payload: trimmed.slice(spaceAt + 1).trim(),
      });
    }
    return lines;
  };

  const start = async () => {
    const lines = await load();
    if (lines.length === 0) {
      onLog(`replay: no usable lines in ${file}`);
      return;
    }
    onLog(`replay: ${lines.length} frames from ${file}, every ${intervalMs}ms, loop=${loop}`);

    let index = 0;
    timer = setInterval(() => {
      if (stopped) return;
      if (index >= lines.length) {
        if (!loop) {
          clearInterval(timer);
          onLog("replay: finished");
          return;
        }
        index = 0;
      }
      const line = lines[index];
      index += 1;
      onFrame({ ...line, receivedAt: new Date().toISOString() });
    }, intervalMs);
  };

  start().catch((error) => onLog(`replay: failed - ${error.message}`));

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}

/**
 * Live MQTT subscription.
 *
 * `mqtt` is imported lazily and is NOT a dependency of the app — the browser
 * bundle must never contain a broker client. Install it only where the
 * collector runs:  npm i mqtt
 *
 * Every option here is a guess until confirmed at 2G. All of them are env vars
 * precisely so that being wrong costs a restart rather than a code change.
 */
export async function mqttSource({
  url,
  topic = "#",
  username,
  password,
  rejectUnauthorized = true,
  onFrame,
  onLog,
}) {
  let mqtt;
  try {
    mqtt = await import("mqtt");
  } catch {
    onLog("mqtt: package not installed. Run `npm i mqtt` in collector/, or use SOURCE=replay.");
    return () => {};
  }

  const client = (mqtt.default ?? mqtt).connect(url, {
    username,
    password,
    rejectUnauthorized,
    reconnectPeriod: 3000,
    connectTimeout: 15_000,
    // A stable, identifiable client id. Some brokers refuse anonymous or
    // colliding ids, and a recognisable name helps their admin find you in the
    // broker log when something is blocked.
    clientId: `utiliq-collector-${Math.random().toString(16).slice(2, 10)}`,
  });

  client.on("connect", () => {
    onLog(`mqtt: connected to ${url}`);
    client.subscribe(topic, { qos: 0 }, (error) => {
      if (error) onLog(`mqtt: subscribe to "${topic}" failed - ${error.message}`);
      else onLog(`mqtt: subscribed to "${topic}"`);
    });
  });

  client.on("message", (topicName, payload) => {
    onFrame({
      topic: topicName,
      payload: payload.toString("utf8"),
      receivedAt: new Date().toISOString(),
    });
  });

  client.on("error", (error) => onLog(`mqtt: ${error.message}`));
  client.on("reconnect", () => onLog("mqtt: reconnecting"));
  client.on("offline", () => onLog("mqtt: offline"));

  return () => client.end(true);
}
