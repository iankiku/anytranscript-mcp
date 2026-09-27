import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolated cache dir, seeded before the UI server module ever computes a
// db path, so this never touches ~/.cache/anytranscript-mcp/traces.db.
process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "anytranscript-mcp-ui-test-"));
process.env.ANYTRANSCRIPT_MCP_UI_PORT = "0"; // ask the OS for a free port

const { recordTrace } = await import("../dist/db.js");

recordTrace({
  tool: "transcribe",
  url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:01.000Z",
  durationMs: 1000,
  ok: true,
  source: "captions",
  language: "en",
  textLength: 42,
  resultJson: JSON.stringify({
    text: "All right, so here we are, in front of the elephants",
    source: "captions",
    language: "en",
    segments: [{ start: 0, end: 4, text: "All right, so here we are" }],
    info: { title: "Me at the zoo", uploader: "jawed" },
  }),
});

recordTrace({
  tool: "transcribe",
  url: "https://example.com/not-a-video",
  startedAt: "2026-01-01T00:00:02.000Z",
  finishedAt: "2026-01-01T00:00:02.500Z",
  durationMs: 500,
  ok: false,
  error: "yt-dlp exited with code 1: no video found",
});

const { server } = await import("../dist/ui.js");

if (!server.listening) {
  await new Promise((resolve) => server.once("listening", resolve));
}
const { port } = server.address();
const base = `http://localhost:${port}`;

after(() => {
  server.close();
});

test("the list page renders both seeded traces", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /anytranscript traces/);
  assert.match(html, /Me at the zoo|jNQXAC9IVRw/);
  assert.match(html, /not-a-video/);
  assert.match(html, /class="ok"/);
  assert.match(html, /class="err"/);
});

test("a trace detail page shows the full transcript text", async () => {
  const res = await fetch(`${base}/trace/1`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Me at the zoo/);
  assert.match(html, /elephants/);
});

test("a trace detail page for an error shows the error text", async () => {
  const res = await fetch(`${base}/trace/2`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /no video found/);
});

test("an unknown trace id 404s", async () => {
  const res = await fetch(`${base}/trace/999999`);
  assert.equal(res.status, 404);
});
