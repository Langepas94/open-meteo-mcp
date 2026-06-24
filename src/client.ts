export async function openMeteoFetch(
  baseUrl: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      // Open-Meteo expects repeated keys for arrays: hourly=temperature_2m&hourly=windspeed_10m
      for (const item of value) {
        query.append(key, String(item));
      }
    } else {
      query.set(key, String(value));
    }
  }

  const url = `${baseUrl}?${query.toString()}`;
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Open-Meteo API error ${res.status}: ${body}`);
  }

  return res.json();
}
