import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Isolated in-memory-like DB per test using a temp file
function makeTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "omcp-test-"));
  const dbPath = join(dir, "test.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, cron_expr TEXT NOT NULL,
      latitude REAL NOT NULL, longitude REAL NOT NULL,
      location TEXT NOT NULL, variables TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL, fetched_at INTEGER NOT NULL, data TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_readings_job_time ON readings(job_id, fetched_at);
  `);
  return { db, dir };
}

describe("jobs table", () => {
  let db: ReturnType<typeof Database>;
  let dir: string;

  beforeEach(() => {
    ({ db, dir } = makeTestDb());
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  it("inserts and retrieves a job", () => {
    db.prepare(
      "INSERT INTO jobs VALUES (@id,@cron_expr,@latitude,@longitude,@location,@variables,@created_at)"
    ).run({
      id: "job-1",
      cron_expr: "0 * * * *",
      latitude: 55.75,
      longitude: 37.62,
      location: "Moscow",
      variables: JSON.stringify(["temperature_2m"]),
      created_at: 1000,
    });

    const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get("job-1") as { location: string };
    expect(row.location).toBe("Moscow");
  });

  it("cascade-deletes readings when job is deleted", () => {
    db.prepare(
      "INSERT INTO jobs VALUES (@id,@cron_expr,@latitude,@longitude,@location,@variables,@created_at)"
    ).run({ id: "j", cron_expr: "*", latitude: 0, longitude: 0, location: "X", variables: "[]", created_at: 0 });

    db.prepare("INSERT INTO readings (job_id, fetched_at, data) VALUES (?,?,?)").run("j", 1, "{}");
    db.prepare("INSERT INTO readings (job_id, fetched_at, data) VALUES (?,?,?)").run("j", 2, "{}");

    db.prepare("DELETE FROM jobs WHERE id = ?").run("j");

    const count = (db.prepare("SELECT COUNT(*) as n FROM readings WHERE job_id = ?").get("j") as { n: number }).n;
    expect(count).toBe(0);
  });
});

describe("readings table", () => {
  let db: ReturnType<typeof Database>;
  let dir: string;

  beforeEach(() => {
    ({ db, dir } = makeTestDb());
    db.prepare(
      "INSERT INTO jobs VALUES (@id,@cron_expr,@latitude,@longitude,@location,@variables,@created_at)"
    ).run({ id: "j1", cron_expr: "*", latitude: 0, longitude: 0, location: "X", variables: "[]", created_at: 0 });
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  it("filters readings by time window", () => {
    db.prepare("INSERT INTO readings (job_id, fetched_at, data) VALUES (?,?,?)").run("j1", 100, "{}");
    db.prepare("INSERT INTO readings (job_id, fetched_at, data) VALUES (?,?,?)").run("j1", 200, "{}");
    db.prepare("INSERT INTO readings (job_id, fetched_at, data) VALUES (?,?,?)").run("j1", 300, "{}");

    const rows = db.prepare(
      "SELECT * FROM readings WHERE job_id = ? AND fetched_at >= ? ORDER BY fetched_at ASC"
    ).all("j1", 150) as unknown[];

    expect(rows).toHaveLength(2);
  });

  it("stores and retrieves JSON data", () => {
    const payload = { hourly: { temperature_2m: [18.5, 19.0] } };
    db.prepare("INSERT INTO readings (job_id, fetched_at, data) VALUES (?,?,?)").run(
      "j1", Date.now(), JSON.stringify(payload)
    );

    const row = db.prepare("SELECT data FROM readings WHERE job_id = ?").get("j1") as { data: string };
    expect(JSON.parse(row.data)).toEqual(payload);
  });
});
