import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { summarize } from "./summarize.js";

// Live transport sessions: sessionId -> the McpServer bound to that connection.
const servers = new Map<string, McpServer>();
// Subscriptions: transport sessionId -> set of app session_ids (job owners)
// it wants summary pushes for, with the period to aggregate.
interface Sub {
  appSession: string;
  period: string;
}
const subs = new Map<string, Sub[]>();

export function registerSession(sessionId: string, server: McpServer) {
  servers.set(sessionId, server);
}

export function unregisterSession(sessionId: string) {
  servers.delete(sessionId);
  subs.delete(sessionId);
}

export function subscribe(sessionId: string, appSession: string, period: string) {
  const list = subs.get(sessionId) ?? [];
  if (!list.some((s) => s.appSession === appSession)) {
    list.push({ appSession, period });
  } else {
    for (const s of list) if (s.appSession === appSession) s.period = period;
  }
  subs.set(sessionId, list);
}

export function unsubscribe(sessionId: string, appSession: string): boolean {
  const list = subs.get(sessionId);
  if (!list) return false;
  const next = list.filter((s) => s.appSession !== appSession);
  subs.set(sessionId, next);
  return next.length !== list.length;
}

/** True if any live session is subscribed to this app session. */
export function hasSubscribers(appSession: string): boolean {
  for (const list of subs.values()) {
    if (list.some((s) => s.appSession === appSession)) return true;
  }
  return false;
}

/**
 * Push a fresh summary for `job` to every session subscribed to its owner.
 * Uses an MCP logging notification — the channel standard clients already
 * receive — carrying a structured `weather_summary` payload. Called by the
 * scheduler after each collection, so clients get periodic summaries WITHOUT
 * polling.
 */
export async function pushSummaryForJob(jobId: string, ownerSession: string) {
  // Find subscribers for this owner across all live sessions.
  for (const [sessionId, list] of subs) {
    const sub = list.find((s) => s.appSession === ownerSession);
    if (!sub) continue;
    const server = servers.get(sessionId);
    if (!server) continue;

    const summary = summarize(jobId, sub.period);
    if (!summary || summary.readings_count === 0) continue;

    try {
      await server.server.sendLoggingMessage(
        {
          level: "info",
          logger: "weather_summary",
          data: summary as unknown as Record<string, unknown>,
        },
        sessionId
      );
    } catch {
      /* client gone; cleanup happens on session close */
    }
  }
}
