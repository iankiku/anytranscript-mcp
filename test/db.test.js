import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the trace store at a throwaway directory before importing it, so
// this never touches the real ~/.cache/anytranscript-mcp/traces.db.
process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "anytranscript-mcp-db-test-"));

const { recordTrace, listTraces, getTrace } = await import("../dist/db.js");

test("records and lists a successful trace", () => {
  recordTrace({
    tool: "transcribe",
    url: "https://example.com/a",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    ok: true,
    source: "captions",
    language: "en",
    textLength: 42,
    resultJson: JSON.stringify({ text: "hello" }),
  });

  const rows = listTraces();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, "https://example.com/a");
  assert.equal(rows[0].ok, 1);
  assert.equal(rows[0].source, "captions");
});

test("records a failed trace with no result_json", () => {
  recordTrace({
    tool: "transcribe",
    url: "https://example.com/b",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:00.500Z",
    durationMs: 500,
    ok: false,
    error: "no captions",
  });

  const rows = listTraces();
  const failed = rows.find((r) => r.url === "https://example.com/b");
  assert.ok(failed);
  assert.equal(failed.ok, 0);
  assert.equal(failed.error, "no captions");
  assert.equal(failed.result_json, null);
});

test("groups batch items under the same batch_id", () => {
  const batchId = "test-batch-1";
  recordTrace({
    batchId,
    tool: "transcribe_batch",
    url: "https://example.com/c",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:00.100Z",
    durationMs: 100,
    ok: true,
    resultJson: JSON.stringify({ text: "c" }),
  });
  recordTrace({
    batchId,
    tool: "transcribe_batch",
    url: "https://example.com/d",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:00.200Z",
    durationMs: 200,
    ok: true,
    resultJson: JSON.stringify({ text: "d" }),
  });

  const rows = listTraces().filter((r) => r.batch_id === batchId);
  assert.equal(rows.length, 2);
});

test("getTrace fetches a single row by id, and undefined for a missing one", () => {
  const [row] = listTraces(1);
  const fetched = getTrace(row.id);
  assert.equal(fetched.url, row.url);
  assert.equal(getTrace(999999), undefined);
});
