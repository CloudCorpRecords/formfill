import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  callTool,
  createAutofillJob,
  decodeBase64,
  DEFAULT_API_URL,
  TOOL_DEFS,
  validateArgs,
} from "../src/formfill.js";
import type { FetchFn, FetchResponseLike, ToolResult } from "../src/types.js";

/**
 * Every test runs against a fake fetch: no live network, no
 * live call is ever made, and no real API key is used.
 */

const SMALL_PDF_B64 = Buffer.from("%PDF-1.4 fake small form").toString("base64");

const UPSTREAM_JOB = {
  job_id: "job-123",
  upload_page_url: "https://app.hellobasestation.com/upload/job-123",
  instructions_summary: "Fill the applicant name as Ada Lovelace",
};

const GOOD_ENV = { BASESTATION_API_KEY: "test-key" };

interface Captured {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  hasSignal: boolean;
}

function makeResponse(status: number, bodyText: string): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => bodyText,
  };
}

function jsonResponse(status: number, payload: unknown) {
  return makeResponse(status, JSON.stringify(payload));
}

function makeFetch(
  handler: (call: Captured) => Promise<FetchResponseLike> | FetchResponseLike,
): { fetchFn: FetchFn; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const captured: Captured = {
      url,
      method: init?.method,
      headers: init?.headers ?? {},
      body: JSON.parse(init?.body ?? "{}") as Record<string, unknown>,
      hasSignal: init?.signal !== undefined,
    };
    calls.push(captured);
    return handler(captured);
  };
  return { fetchFn, calls };
}

function successFetch() {
  return makeFetch(() => jsonResponse(200, UPSTREAM_JOB));
}

function textOf(result: ToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

const GOOD_ARGS = { instructions: "Fill the applicant name", formFile: SMALL_PDF_B64 };

/* ------------------------------------------------------------------ */
/* Success path                                                        */
/* ------------------------------------------------------------------ */

describe("createAutofillJob success", () => {
  it("passes through job_id, upload_page_url and instructions_summary as JSON text", async () => {
    const { fetchFn, calls } = successFetch();
    const result = await createAutofillJob(GOOD_ARGS, { fetchFn, env: GOOD_ENV });
    assert.equal(result.isError, undefined);
    assert.deepEqual(JSON.parse(textOf(result)), UPSTREAM_JOB);
    assert.equal(calls.length, 1);
  });

  it("POSTs the reconstructed wire shape with the bearer key", async () => {
    const { fetchFn, calls } = successFetch();
    await createAutofillJob(
      { ...GOOD_ARGS, callbackUrl: "https://example.com/done" },
      { fetchFn, env: GOOD_ENV },
    );
    assert.equal(calls[0].url, `${DEFAULT_API_URL}/api/autofill/jobs`);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers.Authorization, "Bearer test-key");
    assert.equal(calls[0].headers["Content-Type"], "application/json");
    assert.deepEqual(calls[0].body, {
      instructions: GOOD_ARGS.instructions,
      formFile: SMALL_PDF_B64,
      callbackUrl: "https://example.com/done",
    });
    assert.equal(calls[0].hasSignal, true);
  });

  it("omits callbackUrl from the body when it is not given", async () => {
    const { fetchFn, calls } = successFetch();
    await createAutofillJob(GOOD_ARGS, { fetchFn, env: GOOD_ENV });
    assert.ok(!("callbackUrl" in calls[0].body));
  });

  it("honours BASESTATION_API_URL (trailing slash stripped)", async () => {
    const { fetchFn, calls } = successFetch();
    await createAutofillJob(GOOD_ARGS, {
      fetchFn,
      env: { ...GOOD_ENV, BASESTATION_API_URL: "https://example.test/base/" },
    });
    assert.equal(calls[0].url, "https://example.test/base/api/autofill/jobs");
  });

  it("callTool dispatches the dotted tool name", async () => {
    const { fetchFn } = successFetch();
    const result = await callTool("basestation.create_autofill_job", GOOD_ARGS, {
      fetchFn,
      env: GOOD_ENV,
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(JSON.parse(textOf(result)), UPSTREAM_JOB);
  });
});

/* ------------------------------------------------------------------ */
/* Local guards: no fetch is ever made                                 */
/* ------------------------------------------------------------------ */

describe("local guards", () => {
  it("a missing API key is an honest error naming BASESTATION_API_KEY", async () => {
    const { fetchFn, calls } = successFetch();
    const result = await createAutofillJob(GOOD_ARGS, { fetchFn, env: {} });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /BASESTATION_API_KEY/);
    assert.equal(calls.length, 0);
  });

  it("an empty API key is an honest error naming BASESTATION_API_KEY", async () => {
    const { fetchFn, calls } = successFetch();
    const result = await createAutofillJob(GOOD_ARGS, {
      fetchFn,
      env: { BASESTATION_API_KEY: "   " },
    });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /BASESTATION_API_KEY/);
    assert.equal(calls.length, 0);
  });

  it("an oversize formFile is refused locally, naming the MAX_PDF_MB limit, without any fetch", async () => {
    const bigPdf = Buffer.alloc(4096, 7).toString("base64");
    const { fetchFn, calls } = successFetch();
    const result = await createAutofillJob(
      { instructions: "Fill it", formFile: bigPdf },
      { fetchFn, env: { ...GOOD_ENV, MAX_PDF_MB: "0.001" } },
    );
    assert.equal(result.isError, true);
    assert.match(textOf(result), /MAX_PDF_MB/);
    assert.match(textOf(result), /0\.001 MB/);
    assert.equal(calls.length, 0);
  });

  it("an oversize formFile is refused via the deps limit override too", async () => {
    const { fetchFn, calls } = successFetch();
    const result = await createAutofillJob(GOOD_ARGS, {
      fetchFn,
      env: GOOD_ENV,
      maxPdfMb: 0.00001,
    });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /MAX_PDF_MB/);
    assert.equal(calls.length, 0);
  });

  it("invalid base64 is rejected without any fetch", async () => {
    const { fetchFn, calls } = successFetch();
    const result = await createAutofillJob(
      { instructions: "Fill it", formFile: "not!!base64%%%" },
      { fetchFn, env: GOOD_ENV },
    );
    assert.equal(result.isError, true);
    assert.match(textOf(result), /not valid base64/);
    assert.equal(calls.length, 0);
  });

  it("decodeBase64 round-trips valid input and rejects junk", () => {
    assert.equal(decodeBase64(SMALL_PDF_B64)?.toString(), "%PDF-1.4 fake small form");
    assert.equal(decodeBase64("a"), null);
    assert.equal(decodeBase64("****"), null);
    assert.equal(decodeBase64(""), null);
  });
});

/* ------------------------------------------------------------------ */
/* Upstream failures                                                   */
/* ------------------------------------------------------------------ */

describe("upstream failures", () => {
  it("HTTP 402 surfaces as formfill error with status and upstream error text", async () => {
    const { fetchFn } = makeFetch(() =>
      jsonResponse(402, { error: "Payment required: add a card" }),
    );
    const result = await createAutofillJob(GOOD_ARGS, { fetchFn, env: GOOD_ENV });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /^formfill error: HTTP 402/);
    assert.match(textOf(result), /Payment required/);
  });

  it("HTTP 500 surfaces as formfill error with status and plain-text body", async () => {
    const { fetchFn } = makeFetch(() => makeResponse(500, "Internal Server Error"));
    const result = await createAutofillJob(GOOD_ARGS, { fetchFn, env: GOOD_ENV });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /^formfill error: HTTP 500/);
    assert.match(textOf(result), /Internal Server Error/);
  });

  it("HTTP error with an empty body is just the status", async () => {
    const { fetchFn } = makeFetch(() => makeResponse(503, ""));
    const result = await createAutofillJob(GOOD_ARGS, { fetchFn, env: GOOD_ENV });
    assert.equal(result.isError, true);
    assert.equal(textOf(result), "formfill error: HTTP 503");
  });

  it("a 2xx response missing the pinned fields is an honest error", async () => {
    const { fetchFn } = makeFetch(() => jsonResponse(200, { job_id: "job-9" }));
    const result = await createAutofillJob(GOOD_ARGS, { fetchFn, env: GOOD_ENV });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /missing required field\(s\)/);
    assert.match(textOf(result), /upload_page_url/);
    assert.match(textOf(result), /instructions_summary/);
  });

  it("a 2xx non-JSON response is an honest error", async () => {
    const { fetchFn } = makeFetch(() => makeResponse(200, "<html>ok</html>"));
    const result = await createAutofillJob(GOOD_ARGS, { fetchFn, env: GOOD_ENV });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /not valid JSON/);
  });

  it("a throwing fetch becomes a formfill error, not an exception", async () => {
    const { fetchFn } = makeFetch(() => {
      throw new Error("socket hang up");
    });
    const result = await createAutofillJob(GOOD_ARGS, { fetchFn, env: GOOD_ENV });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /^formfill error: request failed: socket hang up/);
  });

  it("the timeout path aborts and reports the timeout", async () => {
    const { fetchFn, calls } = makeFetch(
      () =>
        new Promise<FetchResponseLike>(() => {
          // Never resolves on its own; the core's abort is
          // observed through the captured signal below.
        }),
    );
    // Wrap: reject when the AbortSignal the core passes fires.
    const abortingFetch: FetchFn = (url, init) => {
      void fetchFn(url, init);
      return new Promise<FetchResponseLike>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    };
    const result = await createAutofillJob(GOOD_ARGS, {
      fetchFn: abortingFetch,
      env: GOOD_ENV,
      timeoutMs: 25,
    });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /formfill error: request timed out after 25 ms/);
    assert.equal(calls.length, 1);
  });

  it("REQUEST_TIMEOUT_MS from env drives the timeout message", async () => {
    const abortingFetch: FetchFn = (_url, init) =>
      new Promise<FetchResponseLike>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const result = await createAutofillJob(GOOD_ARGS, {
      fetchFn: abortingFetch,
      env: { ...GOOD_ENV, REQUEST_TIMEOUT_MS: "30" },
    });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /timed out after 30 ms/);
  });
});

/* ------------------------------------------------------------------ */
/* Malformed arguments                                                 */
/* ------------------------------------------------------------------ */

describe("malformed arguments", () => {
  it("validateArgs names each malformed field", () => {
    assert.match(validateArgs({}) ?? "", /instructions/);
    assert.match(validateArgs({ instructions: "x" }) ?? "", /formFile/);
    assert.match(
      validateArgs({ instructions: 42, formFile: SMALL_PDF_B64 }) ?? "",
      /instructions/,
    );
    assert.match(
      validateArgs({ instructions: "x", formFile: SMALL_PDF_B64, callbackUrl: 7 }) ?? "",
      /callbackUrl/,
    );
    assert.equal(validateArgs(GOOD_ARGS), null);
    assert.equal(
      validateArgs({ ...GOOD_ARGS, callbackUrl: "https://example.com/cb" }),
      null,
    );
  });

  it("malformed args return an isError result from the core with no fetch", async () => {
    const { fetchFn, calls } = successFetch();
    const result = await createAutofillJob(
      { instructions: "x" } as never,
      { fetchFn, env: GOOD_ENV },
    );
    assert.equal(result.isError, true);
    assert.match(textOf(result), /formFile/);
    assert.equal(calls.length, 0);
  });

  it(
    "the MCP layer maps malformed args to McpError InvalidParams (-32602)",
    { timeout: 30000 },
    async () => {
      const root = join(dirname(fileURLToPath(import.meta.url)), "..");
      const proc = spawn(join(root, "node_modules", ".bin", "tsx"), ["src/cli.ts", "mcp"], {
        cwd: root,
        env: { ...process.env, BASESTATION_API_KEY: "test-key" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      try {
        const responses = new Map<number, Record<string, unknown>>();
        let buffer = "";
        proc.stdout.setEncoding("utf8");
        proc.stdout.on("data", (chunk: string) => {
          buffer += chunk;
          let idx = buffer.indexOf("\n");
          while (idx !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            idx = buffer.indexOf("\n");
            if (line === "") continue;
            try {
              const msg = JSON.parse(line) as Record<string, unknown>;
              if (typeof msg.id === "number") responses.set(msg.id, msg);
            } catch {
              // ignore non-JSON noise
            }
          }
        });
        const send = (obj: unknown) => proc.stdin.write(`${JSON.stringify(obj)}\n`);
        const waitFor = async (id: number) => {
          for (let i = 0; i < 200; i++) {
            if (responses.has(id)) return responses.get(id) as Record<string, unknown>;
            await new Promise((r) => setTimeout(r, 50));
          }
          throw new Error(`no response for id ${id}`);
        };
        send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "0.0.0" },
          },
        });
        await waitFor(1);
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "basestation.create_autofill_job",
            arguments: { instructions: "only instructions, no formFile" },
          },
        });
        const callResponse = await waitFor(2);
        const error = callResponse.error as { code: number; message: string };
        assert.equal(error.code, -32602);
        assert.match(error.message, /formFile/);
      } finally {
        proc.kill();
      }
    },
  );
});

/* ------------------------------------------------------------------ */
/* Registration parity with the fixture                                */
/* ------------------------------------------------------------------ */

describe("registration", () => {
  it("the registered tool equals the fixture exactly", (t) => {
    const fixturePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "harness",
      "fixtures",
      "pdfkit-tools-original.json",
    );
    if (!existsSync(fixturePath)) {
      t.skip("parity fixture lives in the build harness, not the repo tree");
      return;
    }
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      tools: unknown[];
    };
    assert.deepEqual(TOOL_DEFS, fixture.tools);
  });
});

/* ------------------------------------------------------------------ */
/* CLI (spawned from source via tsx)                                   */
/* ------------------------------------------------------------------ */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function runCli(args: string[], env: Record<string, string> = {}) {
  return spawnSync(join(root, "node_modules", ".bin", "tsx"), ["src/cli.ts", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("CLI", () => {
  it("--version prints 0.1.0 and exits 0", () => {
    const res = runCli(["--version"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("an unknown subcommand prints usage and exits 2", () => {
    const res = runCli(["not-a-tool"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage:/);
  });

  it("a non-JSON argument string exits 2", () => {
    const res = runCli(["basestation.create_autofill_job", "not json"]);
    assert.equal(res.status, 2);
  });

  it("a JSON array argument exits 2", () => {
    const res = runCli(["basestation.create_autofill_job", "[1,2]"]);
    assert.equal(res.status, 2);
  });

  it("extra arguments after mcp exit 2", () => {
    const res = runCli(["mcp", "extra"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage:/);
  });

  it("a missing-key call exits 1 naming BASESTATION_API_KEY", () => {
    const res = runCli(
      ["basestation.create_autofill_job", JSON.stringify(GOOD_ARGS)],
      { BASESTATION_API_KEY: "" },
    );
    assert.equal(res.status, 1);
    assert.match(res.stderr, /BASESTATION_API_KEY/);
  });

  it("a malformed-args call exits 1 with the field name", () => {
    const res = runCli(
      ["basestation.create_autofill_job", '{"instructions":"x"}'],
      { BASESTATION_API_KEY: "test-key" },
    );
    assert.equal(res.status, 1);
    assert.match(res.stderr, /formFile/);
  });
});
