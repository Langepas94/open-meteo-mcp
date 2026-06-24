import Database, { type Database as BetterSqlite3Database } from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const dataDir = join(homedir(), ".open-meteo-mcp");
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const DB_PATH = join(dataDir, "data.db");

export const db: BetterSqlite3Database = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    cron_expr   TEXT NOT NULL,
    latitude    REAL NOT NULL,
    longitude   REAL NOT NULL,
    location    TEXT NOT NULL,
    variables   TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS readings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id      TEXT NOT NULL,
    fetched_at  INTEGER NOT NULL,
    data        TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_readings_job_time ON readings(job_id, fetched_at);
`);

// migrate: add session_id if absent (existing DBs won't have it)
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN session_id TEXT NOT NULL DEFAULT 'default'`);
} catch { /* column already exists */ }

db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_session ON jobs(session_id)`);

export interface Job {
  id: string;
  session_id: string;
  cron_expr: string;
  latitude: number;
  longitude: number;
  location: string;
  variables: string[];
  created_at: number;
}

export interface Reading {
  id: number;
  job_id: string;
  fetched_at: number;
  data: Record<string, unknown>;
}

export const jobsRepo = {
  insert(job: Job) {
    db.prepare(`
      INSERT INTO jobs (id, session_id, cron_expr, latitude, longitude, location, variables, created_at)
      VALUES (@id, @session_id, @cron_expr, @latitude, @longitude, @location, @variables, @created_at)
    `).run({ ...job, variables: JSON.stringify(job.variables) });
  },

  listBySession(session_id: string): Job[] {
    const rows = db.prepare(
      "SELECT * FROM jobs WHERE session_id = ? ORDER BY created_at DESC"
    ).all(session_id) as Array<Job & { variables: string }>;
    return rows.map((r) => ({ ...r, variables: JSON.parse(r.variables) }));
  },

  // used by restoreJobs on startup — restore ALL jobs regardless of session
  listAll(): Job[] {
    const rows = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all() as Array<Job & { variables: string }>;
    return rows.map((r) => ({ ...r, variables: JSON.parse(r.variables) }));
  },

  get(id: string): Job | undefined {
    const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as (Job & { variables: string }) | undefined;
    if (!row) return undefined;
    return { ...row, variables: JSON.parse(row.variables) };
  },

  delete(id: string) {
    db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
  },
};

export const readingsRepo = {
  insert(job_id: string, data: Record<string, unknown>) {
    db.prepare(`
      INSERT INTO readings (job_id, fetched_at, data) VALUES (?, ?, ?)
    `).run(job_id, Date.now(), JSON.stringify(data));
  },

  getRecent(job_id: string, since_ms: number): Reading[] {
    const rows = db.prepare(`
      SELECT * FROM readings WHERE job_id = ? AND fetched_at >= ? ORDER BY fetched_at ASC
    `).all(job_id, since_ms) as Array<Reading & { data: string }>;
    return rows.map((r) => ({ ...r, data: JSON.parse(r.data) }));
  },

  countByJob(job_id: string): number {
    const row = db.prepare("SELECT COUNT(*) as n FROM readings WHERE job_id = ?").get(job_id) as { n: number };
    return row.n;
  },
};
