/**
 * Local trace store. Every `transcribe` / `transcribe_batch` call is logged
 * to a SQLite file under the cache dir, so a run can be inspected later —
 * from the web viewer (`anytranscript-mcp-ui`) or a raw `sqlite3` query —
 * without re-running anything.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** `~/.cache/anytranscript-mcp`, or wherever XDG_CACHE_HOME points. */
function cacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "anytranscript-mcp");
}

export function dbPath(): string {
  return join(cacheDir(), "traces.db");
}

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(cacheDir(), { recursive: true });
  db = new DatabaseSync(dbPath());
  db.exec(`
    CREATE TABLE IF NOT EXISTS traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT,
      tool TEXT NOT NULL,
      url TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      source TEXT,
      language TEXT,
      model TEXT,
      backend TEXT,
      text_length INTEGER,
      error TEXT,
      result_json TEXT
    )
  `);
  return db;
}

export interface TraceInput {
  batchId?: string;
  tool: "transcribe" | "transcribe_batch";
  url: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  source?: string;
  language?: string;
  model?: string;
  backend?: string;
  textLength?: number;
  error?: string;
  resultJson?: string;
}

export function recordTrace(rec: TraceInput): void {
  getDb()
    .prepare(
      `INSERT INTO traces
        (batch_id, tool, url, started_at, finished_at, duration_ms, ok,
         source, language, model, backend, text_length, error, result_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      rec.batchId ?? null,
      rec.tool,
      rec.url,
      rec.startedAt,
      rec.finishedAt,
      rec.durationMs,
      rec.ok ? 1 : 0,
      rec.source ?? null,
      rec.language ?? null,
      rec.model ?? null,
      rec.backend ?? null,
      rec.textLength ?? null,
      rec.error ?? null,
      rec.resultJson ?? null
    );
}

export interface TraceRow {
  id: number;
  batch_id: string | null;
  tool: string;
  url: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  ok: number;
  source: string | null;
  language: string | null;
  model: string | null;
  backend: string | null;
  text_length: number | null;
  error: string | null;
  result_json: string | null;
}

export function listTraces(limit = 200): TraceRow[] {
  return getDb()
    .prepare(`SELECT * FROM traces ORDER BY id DESC LIMIT ?`)
    .all(limit) as unknown as TraceRow[];
}

export function getTrace(id: number): TraceRow | undefined {
  return getDb().prepare(`SELECT * FROM traces WHERE id = ?`).get(id) as
    | TraceRow
    | undefined;
}
