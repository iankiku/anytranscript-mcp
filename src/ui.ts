#!/usr/bin/env node
/**
 * A small local web dashboard over the trace store `server.ts` writes to.
 * Separate process from the MCP stdio server on purpose — this speaks
 * plain HTTP on localhost, and nothing about it is part of the MCP
 * protocol.
 */

import { createServer } from "node:http";
import { listTraces, getTrace, dbPath } from "./db.js";

const PORT = Number(process.env.ANYTRANSCRIPT_MCP_UI_PORT ?? 4317);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; color: #1a1a1a; background: #fafafa; }
  h1 { font-size: 1.25rem; }
  h2 { font-size: 1.05rem; margin-top: 1.5rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #ddd; font-size: 0.9rem; vertical-align: top; }
  th { color: #666; font-weight: 600; white-space: nowrap; }
  tr:hover { background: #f0f0f0; }
  a { color: #0645ad; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .ok { color: #1a7f37; }
  .err { color: #cf222e; }
  .muted { color: #888; }
  pre { background: #fff; border: 1px solid #ddd; padding: 1rem; overflow: auto; border-radius: 6px; white-space: pre-wrap; word-break: break-word; }
  code { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function listPage(): string {
  const rows = listTraces(200);
  const body = rows
    .map((r) => {
      const status = r.ok ? '<span class="ok">ok</span>' : '<span class="err">error</span>';
      return `<tr>
        <td><a href="/trace/${r.id}">#${r.id}</a></td>
        <td>${escapeHtml(r.tool)}</td>
        <td>${status}</td>
        <td title="${escapeHtml(r.url)}"><a href="/trace/${r.id}">${escapeHtml(truncate(r.url, 60))}</a></td>
        <td>${escapeHtml(r.source ?? "")}</td>
        <td>${r.duration_ms} ms</td>
        <td class="muted">${escapeHtml(r.started_at)}</td>
      </tr>`;
    })
    .join("\n");

  return page(
    "anytranscript traces",
    `<h1>anytranscript traces</h1>
    <p class="muted">${rows.length} most recent run${rows.length === 1 ? "" : "s"} — <code>${escapeHtml(dbPath())}</code></p>
    <table>
      <tr><th>id</th><th>tool</th><th>status</th><th>url</th><th>source</th><th>duration</th><th>started</th></tr>
      ${body || '<tr><td colspan="7" class="muted">No runs yet.</td></tr>'}
    </table>`
  );
}

function tracePage(id: number): string | undefined {
  const r = getTrace(id);
  if (!r) return undefined;

  let detail: string;
  if (r.ok && r.result_json) {
    const transcript = JSON.parse(r.result_json);
    detail = `<h2>Transcript</h2>
      <p><strong>${escapeHtml(transcript.info?.title ?? "")}</strong>${
        transcript.info?.uploader ? ` — ${escapeHtml(transcript.info.uploader)}` : ""
      }</p>
      <pre>${escapeHtml(transcript.text)}</pre>
      <h2>Segments (${transcript.segments.length})</h2>
      <pre>${escapeHtml(JSON.stringify(transcript.segments, null, 2))}</pre>`;
  } else {
    detail = `<h2>Error</h2><pre class="err">${escapeHtml(r.error ?? "")}</pre>`;
  }

  return page(
    `trace #${r.id}`,
    `<p><a href="/">&larr; all traces</a></p>
    <h1>#${r.id} — ${escapeHtml(r.tool)}</h1>
    <table>
      <tr><th>url</th><td>${escapeHtml(r.url)}</td></tr>
      <tr><th>status</th><td>${r.ok ? '<span class="ok">ok</span>' : '<span class="err">error</span>'}</td></tr>
      <tr><th>source</th><td>${escapeHtml(r.source ?? "—")}</td></tr>
      <tr><th>language</th><td>${escapeHtml(r.language ?? "—")}</td></tr>
      <tr><th>model / backend</th><td>${escapeHtml(r.model ?? "—")} / ${escapeHtml(r.backend ?? "—")}</td></tr>
      <tr><th>duration</th><td>${r.duration_ms} ms</td></tr>
      <tr><th>started</th><td>${escapeHtml(r.started_at)}</td></tr>
      <tr><th>batch</th><td>${escapeHtml(r.batch_id ?? "—")}</td></tr>
    </table>
    ${detail}`
  );
}

export const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(listPage());
    return;
  }

  const traceMatch = url.pathname.match(/^\/trace\/(\d+)$/);
  if (traceMatch) {
    const html = tracePage(Number(traceMatch[1]));
    if (!html) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  const { port } = server.address() as { port: number };
  console.log(`[anytranscript-mcp-ui] http://localhost:${port}`);
});
