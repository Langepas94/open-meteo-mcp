import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock summarize so we don't need a real DB — we only test push routing.
vi.mock("../src/summarize.js", () => ({
  summarize: vi.fn((jobId: string, period: string) => ({
    job_id: jobId,
    location: "Testville",
    session_id: "chat-1",
    period,
    readings_count: 3,
    stats: { temperature_2m: { min: 1, max: 9, avg: 5, count: 3 } },
  })),
}));

import {
  registerSession,
  unregisterSession,
  subscribe,
  unsubscribe,
  hasSubscribers,
  pushSummaryForJob,
} from "../src/notifications.js";

function fakeServer() {
  const sent: any[] = [];
  return {
    sent,
    server: {
      sendLoggingMessage: vi.fn(async (params: any) => {
        sent.push(params);
      }),
    },
  } as any;
}

describe("notifications push routing", () => {
  beforeEach(() => {
    // clear any leftover sessions
    for (const sid of ["s1", "s2"]) unregisterSession(sid);
  });

  it("pushes a summary only to sessions subscribed to the job owner", async () => {
    const a = fakeServer();
    const b = fakeServer();
    registerSession("s1", a);
    registerSession("s2", b);

    subscribe("s1", "chat-1", "1h"); // s1 wants chat-1
    subscribe("s2", "chat-2", "1h"); // s2 wants chat-2 only

    await pushSummaryForJob("job-xyz", "chat-1");

    expect(a.server.sendLoggingMessage).toHaveBeenCalledTimes(1);
    expect(b.server.sendLoggingMessage).not.toHaveBeenCalled();
    expect(a.sent[0].logger).toBe("weather_summary");
    expect(a.sent[0].data.job_id).toBe("job-xyz");
    expect(a.sent[0].data.session_id).toBe("chat-1");
  });

  it("hasSubscribers reflects subscribe/unsubscribe", async () => {
    registerSession("s1", fakeServer());
    expect(hasSubscribers("chat-9")).toBe(false);
    subscribe("s1", "chat-9", "6h");
    expect(hasSubscribers("chat-9")).toBe(true);
    expect(unsubscribe("s1", "chat-9")).toBe(true);
    expect(hasSubscribers("chat-9")).toBe(false);
  });

  it("stops pushing after the session is unregistered", async () => {
    const a = fakeServer();
    registerSession("s1", a);
    subscribe("s1", "chat-1", "1h");
    unregisterSession("s1");
    await pushSummaryForJob("job-1", "chat-1");
    expect(a.server.sendLoggingMessage).not.toHaveBeenCalled();
  });
});
