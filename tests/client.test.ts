import { describe, it, expect, vi, beforeEach } from "vitest";
import { openMeteoFetch } from "../src/client.js";

function mockFetch(response: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(JSON.stringify(response)),
  });
}

describe("openMeteoFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("builds correct URL with simple params", async () => {
    const fetcher = mockFetch({ latitude: 55.75, longitude: 37.62 });
    vi.stubGlobal("fetch", fetcher);

    await openMeteoFetch("https://api.open-meteo.com/v1/forecast", {
      latitude: 55.75,
      longitude: 37.62,
      timezone: "auto",
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const url = new URL(fetcher.mock.calls[0][0] as string);
    expect(url.searchParams.get("latitude")).toBe("55.75");
    expect(url.searchParams.get("longitude")).toBe("37.62");
    expect(url.searchParams.get("timezone")).toBe("auto");
  });

  it("expands array params as repeated keys", async () => {
    const fetcher = mockFetch({});
    vi.stubGlobal("fetch", fetcher);

    await openMeteoFetch("https://api.open-meteo.com/v1/forecast", {
      latitude: 55.75,
      longitude: 37.62,
      hourly: ["temperature_2m", "precipitation"],
    });

    const url = new URL(fetcher.mock.calls[0][0] as string);
    expect(url.searchParams.getAll("hourly")).toEqual(["temperature_2m", "precipitation"]);
  });

  it("skips null and undefined params", async () => {
    const fetcher = mockFetch({});
    vi.stubGlobal("fetch", fetcher);

    await openMeteoFetch("https://api.open-meteo.com/v1/forecast", {
      latitude: 55.75,
      longitude: 37.62,
      past_days: undefined,
      start_date: null,
    });

    const url = new URL(fetcher.mock.calls[0][0] as string);
    expect(url.searchParams.has("past_days")).toBe(false);
    expect(url.searchParams.has("start_date")).toBe(false);
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetch({ reason: "bad params" }, false));

    await expect(
      openMeteoFetch("https://api.open-meteo.com/v1/forecast", { latitude: 999, longitude: 0 })
    ).rejects.toThrow("Open-Meteo API error 400");
  });

  it("returns parsed JSON on success", async () => {
    const payload = { hourly: { temperature_2m: [20, 21] } };
    vi.stubGlobal("fetch", mockFetch(payload));

    const result = await openMeteoFetch("https://api.open-meteo.com/v1/forecast", {
      latitude: 55.75,
      longitude: 37.62,
    });

    expect(result).toEqual(payload);
  });
});
