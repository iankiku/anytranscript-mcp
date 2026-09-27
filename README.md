# anytranscript-mcp

**[anytranscript](https://github.com/iankiku/anytranscript), as an MCP tool call.**

Any [MCP](https://modelcontextprotocol.io) client — Claude Code, Claude
Desktop, or your own host — gets a `transcribe` tool instead of having to
shell out to a CLI and parse stdout, exit codes, and stderr conventions
itself.

```console
$ npx @iankiku/anytranscript-mcp
[anytranscript-mcp] listening on stdio
```

That's the whole server. It speaks MCP over stdio; point a client at it and
call `transcribe` or `transcribe_batch`. Every call — through either tool —
is logged to a local SQLite trace store; see [Tracing](#tracing) to browse
it.

## Add it to a client

### Claude Code

```bash
claude mcp add anytranscript -- npx -y @iankiku/anytranscript-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "anytranscript": {
      "command": "npx",
      "args": ["-y", "@iankiku/anytranscript-mcp"]
    }
  }
}
```

### Any other MCP host

Run `npx @iankiku/anytranscript-mcp` as a subprocess and connect over its
stdio, the same as any other stdio MCP server. There's no HTTP mode.

## The `transcribe` tool

| Input | Type | Default | Effect |
|---|---|---|---|
| `url` | string | — | The video URL to transcribe (required) |
| `lang` | string | `en` | Caption/transcription language code |
| `model` | `tiny` \| `base` \| `small` \| `medium` \| `large-v3` | `small` | Whisper model size, when there's no caption track |
| `backend` | `auto` \| `local` \| `openai` \| `groq` | `auto` | Which speech-to-text engine to use |
| `whisperOnly` | boolean | `false` | Skip the caption lookup, always transcribe audio |
| `captionsOnly` | boolean | `false` | Never fall back to Whisper; error if there are no captions |
| `cookiesFromBrowser` | string | — | Borrow cookies from `chrome`, `safari`, `firefox`, `edge`… for login-walled content |

Returns a JSON text block:

```json
{
  "text": "All right, so here we are, in front of the elephants...",
  "source": "captions",
  "language": "en",
  "segments": [{ "start": 0.24, "end": 4.19, "text": "All right, so here we are..." }],
  "info": { "id": "jNQXAC9IVRw", "title": "Me at the zoo", "uploader": "jawed", "duration": 19, "extractor": "youtube" }
}
```

On failure — no captions with `captionsOnly` set, a network error, an
unreachable URL — the tool result comes back with `isError: true` and a
plain-text reason, not a thrown protocol error. Callers can branch on that
without needing to parse an exit code.

## The `transcribe_batch` tool

Same inputs as `transcribe`, plus:

| Input | Type | Default | Effect |
|---|---|---|---|
| `urls` | string[] | — | The video URLs to transcribe (required, 1–200) |
| `concurrency` | number | `3` | How many to run at once (1–8) |

This tool doesn't read CSVs or files itself — if you have a spreadsheet or
a list of URLs in a file, have the agent read it and pass the URLs it found
as `urls`. Keeping the tool to "a list of URLs in, results out" avoids the
tool guessing which column or format holds the URL.

Returns a compact summary, not the full transcript of each URL — with 200
URLs in flight, the full text of every one would flood the response:

```json
{
  "batchId": "3f0e2e0e-...",
  "results": [
    { "url": "https://youtube.com/watch?v=...", "ok": true, "source": "captions", "language": "en", "textLength": 4021, "title": "..." },
    { "url": "https://instagram.com/reel/...", "ok": false, "error": "yt-dlp exited with code 1: ..." }
  ]
}
```

The full transcript of every item is still there — in the trace store, keyed
by the same `batchId`. Open the dashboard (below) to read any of them in
full.

## Tracing

Every `transcribe` and `transcribe_batch` call — success or failure — is
logged to `~/.cache/anytranscript-mcp/traces.db` (a plain SQLite file, or
wherever `XDG_CACHE_HOME` points). Nothing about this touches the MCP
protocol; it's a side effect of the tool handlers, so a client never sees it
unless it goes looking.

To browse it:

```bash
npx --package=@iankiku/anytranscript-mcp anytranscript-mcp-ui
# [anytranscript-mcp-ui] http://localhost:4317
```

(That's a second bin in the same package, not a separate install — `npx
<name>` alone only resolves a bin that shares the package's name, so the
viewer needs `--package=`. If you installed globally with `npm install -g
@iankiku/anytranscript-mcp`, just run `anytranscript-mcp-ui` directly.)

Open that URL for a table of recent runs — status, timing, source, URL —
and click through to any row for the full transcript or the full error. Set
`ANYTRANSCRIPT_MCP_UI_PORT` to use a different port. It's read-only and
local-only: nothing here talks to the network.

Don't want the history at all? Delete the file — it's recreated on the next
run.

## Requirements

- **Node 22.5+** — a higher floor than anytranscript's own Node 20.6+,
  because tracing uses the built-in `node:sqlite` module (still marked
  experimental by Node itself; it prints one harmless warning line to
  stderr on startup).
- `ffmpeg` on `PATH`.
- For local transcription: `brew install whisper-cpp` (or set
  `OPENAI_API_KEY` / `GROQ_API_KEY` to transcribe over the network instead).
- yt-dlp and Whisper model weights download and cache on first use — nothing
  extra to install up front.

## Why a separate package

anytranscript's core library and CLI are a deliberate zero-runtime-dependency
build — that's load-bearing for a tool that runs with the user's browser
cookies. The MCP SDK, by contrast, pulls in a real dependency tree (it also
implements HTTP transport, which this server doesn't use). Keeping the MCP
server in its own package means installing the CLI/library never pulls any
of that in, and installing this package is opt-in for whoever actually wants
an MCP tool.

## License

[MIT](LICENSE)
