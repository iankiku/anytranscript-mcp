import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, "..", "dist", "server.js");

// A dedicated cache dir for this run, so the trace store this test exercises
// never touches ~/.cache/anytranscript-mcp/traces.db on the machine running it.
const cacheHome = mkdtempSync(path.join(tmpdir(), "anytranscript-mcp-server-test-"));

// A short, stable, public-domain video with real YouTube captions — the
// same fixture anytranscript's own README uses.
const ZOO_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

async function withClient(fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, XDG_CACHE_HOME: cacheHome },
  });
  const client = new Client({ name: "anytranscript-mcp-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

test("advertises the transcribe tool with its input schema", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const transcribeTool = tools.find((t) => t.name === "transcribe");
    assert.ok(transcribeTool, "transcribe tool should be registered");
    assert.ok(transcribeTool.inputSchema.properties.url, "url is a documented input");
    assert.ok(
      transcribeTool.inputSchema.properties.captionsOnly,
      "captionsOnly is a documented input"
    );
  });
});

test("transcribes a real URL end to end via the caption path", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "transcribe",
      arguments: { url: ZOO_URL, captionsOnly: true },
    });

    assert.equal(result.isError, undefined, "should not be an error result");
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");

    const transcript = JSON.parse(result.content[0].text);
    assert.equal(transcript.source, "captions");
    assert.match(transcript.text.toLowerCase(), /elephant/);
    assert.ok(Array.isArray(transcript.segments) && transcript.segments.length > 0);
    assert.ok(typeof transcript.segments[0].start === "number");
  });
});

test("a bad URL comes back as a tool error, not a protocol failure", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "transcribe",
      arguments: { url: "https://example.com/not-a-video", captionsOnly: true },
    });

    assert.equal(result.isError, true);
    assert.equal(result.content[0].type, "text");
    assert.ok(result.content[0].text.length > 0);
  });
});

test("transcribe_batch runs a mix of good and bad URLs and summarizes each", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "transcribe_batch",
      arguments: {
        urls: [ZOO_URL, "https://example.com/not-a-video"],
        captionsOnly: true,
      },
    });

    assert.equal(result.isError, undefined);
    const { batchId, results } = JSON.parse(result.content[0].text);
    assert.ok(batchId);
    assert.equal(results.length, 2);

    const good = results.find((r) => r.url === ZOO_URL);
    assert.equal(good.ok, true);
    assert.equal(good.source, "captions");
    assert.ok(good.textLength > 0);

    const bad = results.find((r) => r.url === "https://example.com/not-a-video");
    assert.equal(bad.ok, false);
    assert.ok(bad.error.length > 0);
  });
});

test("every transcribe and transcribe_batch call lands in the trace store", async () => {
  process.env.XDG_CACHE_HOME = cacheHome;
  const { listTraces } = await import("../dist/db.js");
  const rows = listTraces();

  assert.ok(rows.length >= 4, `expected at least 4 traced runs, got ${rows.length}`);
  assert.ok(rows.some((r) => r.tool === "transcribe" && r.ok === 1));
  assert.ok(rows.some((r) => r.tool === "transcribe" && r.ok === 0));
  assert.ok(rows.some((r) => r.tool === "transcribe_batch" && r.batch_id));
});
