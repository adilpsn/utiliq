#!/usr/bin/env node
import { createServer } from "node:http";
import process from "node:process";

import { mqttSource, replaySource } from "./sources.mjs";

/**
 * Utiliq collector — a dumb bridge.
 *
 * broker (MQTT) ──► collector ──SSE──► Utiliq app
 *
 * It subscribes, and it forwards. It does not parse payloads, apply units, or
 * know what a test bench is. That keeps exactly one place in the system where
 * wire-format assumptions live (src/lib/telemetry/parse.ts).
 *
 * Why a separate process rather than an in-app MQTT client:
 *   - a browser cannot open a raw TCP MQTT connection, and 2G's broker may not
 *     expose a WebSocket listener;
 *   - Cloudflare Workers (the app's likely deploy target) are request-scoped
 *     and cannot hold a persistent subscriber;
 *   - if the broker is plant-network-only, this process runs at the edge and
 *     pushes outward, with no change to the app.
 *
 * Usage
 *   node collector/index.mjs                       # replay the sample dump
 *   REPLAY_FILE=2g_topics.txt node collector/index.mjs
 *   SOURCE=mqtt MQTT_URL=mqtt://10.0.0.5:1883 node collector/index.mjs
 */

const config = {
  port: Number(process.env.PORT ?? 4000),
  source: process.env.SOURCE ?? "replay",
  replayFile: process.env.REPLAY_FILE ?? new URL("./sample-dump.txt", import.meta.url).pathname,
  replayIntervalMs: Number(process.env.REPLAY_INTERVAL_MS ?? 1000),
  replayLoop: process.env.REPLAY_LOOP !== "0",
  mqttUrl: process.env.MQTT_URL ?? "mqtt://localhost:1883",
  mqttTopic: process.env.MQTT_TOPIC ?? "#",
  mqttUsername: process.env.MQTT_USERNAME,
  mqttPassword: process.env.MQTT_PASSWORD,
  // Set MQTT_INSECURE=1 only for a self-signed broker certificate on a trusted
  // network, and never in production.
  mqttRejectUnauthorized: process.env.MQTT_INSECURE !== "1",
  origin: process.env.CORS_ORIGIN ?? "*",
  /** Frames are batched before being pushed, so a chatty broker cannot flood the client. */
  flushMs: Number(process.env.FLUSH_MS ?? 200),
};

const log = (message) => console.log(`[collector] ${message}`);

/** @type {Set<import("node:http").ServerResponse>} */
const clients = new Set();
let buffer = [];
const stats = { frames: 0, startedAt: new Date().toISOString(), lastTopic: null };

function onFrame(frame) {
  stats.frames += 1;
  stats.lastTopic = frame.topic;
  buffer.push(frame);
}

setInterval(() => {
  if (buffer.length === 0 || clients.size === 0) {
    buffer = [];
    return;
  }
  const batch = buffer;
  buffer = [];
  const chunk = `data: ${JSON.stringify(batch)}\n\n`;
  for (const client of clients) {
    // Backpressure: if a client is not draining, drop it rather than buffering
    // the plant's telemetry into memory.
    if (!client.write(chunk)) {
      log("slow client dropped");
      client.end();
      clients.delete(client);
    }
  }
}, config.flushMs);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  response.setHeader("Access-Control-Allow-Origin", config.origin);
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        source: config.source,
        clients: clients.size,
        framesForwarded: stats.frames,
        lastTopic: stats.lastTopic,
        startedAt: stats.startedAt,
      }),
    );
    return;
  }

  if (url.pathname === "/stream") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Industrial networks love a transparent proxy; this stops nginx buffering
      // the stream into uselessness.
      "x-accel-buffering": "no",
    });
    response.write(`: connected to utiliq collector (${config.source})\n\n`);
    clients.add(response);
    log(`client connected (${clients.size} total)`);

    const keepAlive = setInterval(() => response.write(": ping\n\n"), 20_000);
    request.on("close", () => {
      clearInterval(keepAlive);
      clients.delete(response);
      log(`client disconnected (${clients.size} remaining)`);
    });
    return;
  }

  response.writeHead(404, { "content-type": "text/plain" });
  response.end("utiliq collector: try /stream or /health\n");
});

server.listen(config.port, () => {
  log(`listening on http://localhost:${config.port}  (stream: /stream, health: /health)`);
  log(`source: ${config.source}`);
});

if (config.source === "mqtt") {
  await mqttSource({
    url: config.mqttUrl,
    topic: config.mqttTopic,
    username: config.mqttUsername,
    password: config.mqttPassword,
    rejectUnauthorized: config.mqttRejectUnauthorized,
    onFrame,
    onLog: log,
  });
} else {
  replaySource({
    file: config.replayFile,
    intervalMs: config.replayIntervalMs,
    loop: config.replayLoop,
    onFrame,
    onLog: log,
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log("shutting down");
    for (const client of clients) client.end();
    server.close(() => process.exit(0));
  });
}
