#!/usr/bin/env node
/**
 * MCP server for anytranscript. Exposes `transcribe` and `transcribe_batch`
 * as tool calls over stdio, so any MCP client (Claude Code, Claude Desktop,
 * or a custom host) can get a video transcript without shelling out to a
 * CLI and parsing its stdout/exit-code conventions itself.
 *
 * Every call is logged to a local SQLite trace store (see db.ts); run
 * `anytranscript-mcp-ui` to browse it.
 */

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  transcribe,
  NoCaptionsError,
  type ModelSize,
  type Transcript,
  type WhisperBackend,
} from "@iankiku/anytranscript";
import { recordTrace } from "./db.js";

const MODEL_SIZES = ["tiny", "base", "small", "medium", "large-v3"] as const;
const BACKENDS = ["auto", "local", "openai", "groq"] as const;

interface TranscribeArgs {
  lang?: string;
  model?: (typeof MODEL_SIZES)[number];
  backend?: (typeof BACKENDS)[number];
  whisperOnly?: boolean;
  captionsOnly?: boolean;
  cookiesFromBrowser?: string;
}

/** Errors this tool can name specifically, versus a generic message. */
function errorMessage(err: unknown, url: string): string {
  if (err instanceof NoCaptionsError) {
    return `No captions available for ${url}, and captionsOnly was set. Retry without captionsOnly to fall back to Whisper.`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs one transcription, recording a trace row regardless of outcome.
 * Shared by the `transcribe` and `transcribe_batch` tools so both get the
 * same tracing for free.
 */
async function runOne(
  url: string,
  args: TranscribeArgs,
  tool: "transcribe" | "transcribe_batch",
  batchId?: string
): Promise<{ ok: true; transcript: Transcript } | { ok: false; error: string }> {
  const startedAt = new Date();
  try {
    const transcript = await transcribe(url, {
      lang: args.lang,
      model: args.model as ModelSize | undefined,
      backend: args.backend as WhisperBackend | undefined,
      whisperOnly: args.whisperOnly,
      captionsOnly: args.captionsOnly,
      cookiesFromBrowser: args.cookiesFromBrowser,
      onProgress: (message) => console.error(`[anytranscript] ${message}`),
    });
    const finishedAt = new Date();
    recordTrace({
      batchId,
      tool,
      url,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      ok: true,
      source: transcript.source,
      language: transcript.language,
      model: args.model,
      backend: args.backend,
      textLength: transcript.text.length,
      resultJson: JSON.stringify(transcript),
    });
    return { ok: true, transcript };
  } catch (err) {
    const finishedAt = new Date();
    const message = errorMessage(err, url);
    recordTrace({
      batchId,
      tool,
      url,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      ok: false,
      model: args.model,
      backend: args.backend,
      error: message,
    });
    return { ok: false, error: message };
  }
}

/** Runs `items` through `worker` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function runNext(): Promise<void> {
    const i = next++;
    if (i >= items.length) return;
    results[i] = await worker(items[i]!);
    await runNext();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

const server = new McpServer({
  name: "anytranscript",
  version: "0.2.0",
});

const transcribeOptionsSchema = {
  lang: z
    .string()
    .optional()
    .describe("Caption/transcription language code. Defaults to 'en'."),
  model: z
    .enum(MODEL_SIZES)
    .optional()
    .describe(
      "Whisper model size for the speech-to-text path, when there's no " +
        "caption track. Defaults to 'small'."
    ),
  backend: z
    .enum(BACKENDS)
    .optional()
    .describe(
      "Which speech-to-text engine to use: 'local' (whisper.cpp, nothing " +
        "leaves the machine), 'openai', 'groq', or 'auto' (prefers local, " +
        "falls back to whichever API key is set)."
    ),
  whisperOnly: z
    .boolean()
    .optional()
    .describe("Skip the caption lookup and always transcribe the audio."),
  captionsOnly: z
    .boolean()
    .optional()
    .describe("Never fall back to Whisper; fail if the video has no captions."),
  cookiesFromBrowser: z
    .string()
    .optional()
    .describe(
      "Borrow cookies from an installed browser (chrome, safari, firefox, " +
        "edge...) for login-walled content, e.g. most Instagram reels."
    ),
};

server.registerTool(
  "transcribe",
  {
    title: "Transcribe a video URL",
    description:
      "Transcribe one video URL — YouTube, Instagram, TikTok, and 1,800+ " +
      "sites reachable via yt-dlp. Uses the platform's own captions when " +
      "they exist, and falls back to Whisper speech-to-text when they " +
      "don't. Returns the full text plus timestamped segments. For many " +
      "URLs at once, use transcribe_batch instead.",
    inputSchema: {
      url: z.string().url().describe("The video URL to transcribe"),
      ...transcribeOptionsSchema,
    },
  },
  async ({ url, ...args }) => {
    const outcome = await runOne(url, args, "transcribe");
    if (!outcome.ok) {
      return { isError: true, content: [{ type: "text", text: outcome.error }] };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(outcome.transcript, null, 2) }],
    };
  }
);

server.registerTool(
  "transcribe_batch",
  {
    title: "Transcribe many video URLs",
    description:
      "Transcribe a list of video URLs. Runs them with a few in flight at " +
      "once and returns a compact summary row per URL — not the full " +
      "text of each, to avoid flooding the response. This tool doesn't " +
      "read CSVs or files itself: read the file and pass the URLs you " +
      "extracted from it. Every run, in full, is still written to the " +
      "local trace store — browse it with `anytranscript-mcp-ui`.",
    inputSchema: {
      urls: z
        .array(z.string().url())
        .min(1)
        .max(200)
        .describe("The video URLs to transcribe"),
      concurrency: z
        .number()
        .int()
        .min(1)
        .max(8)
        .optional()
        .describe("How many to run at once. Defaults to 3."),
      ...transcribeOptionsSchema,
    },
  },
  async ({ urls, concurrency, ...args }) => {
    const batchId = randomUUID();
    const outcomes = await mapWithConcurrency(urls, concurrency ?? 3, (url) =>
      runOne(url, args, "transcribe_batch", batchId)
    );

    const summary = outcomes.map((outcome, i) => {
      const url = urls[i]!;
      if (outcome.ok) {
        return {
          url,
          ok: true,
          source: outcome.transcript.source,
          language: outcome.transcript.language,
          textLength: outcome.transcript.text.length,
          title: outcome.transcript.info.title,
        };
      }
      return { url, ok: false, error: outcome.error };
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ batchId, results: summary }, null, 2),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[anytranscript-mcp] listening on stdio");
}

main().catch((err) => {
  console.error("[anytranscript-mcp] fatal:", err);
  process.exit(1);
});
