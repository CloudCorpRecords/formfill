/**
 * formfill core: an API-key REST client for the BaseStation
 * PDF autofill API.
 *
 * The single tool, `basestation.create_autofill_job`, takes
 * natural-language instructions and a base64-encoded PDF and
 * creates an autofill job. On success the upstream JSON —
 * carrying `job_id`, `upload_page_url` and
 * `instructions_summary` — is returned as JSON text.
 *
 * Wire (LABELLED RECONSTRUCTION): the upstream README pins
 * the tool's parameters, returns and configuration but not
 * the API's endpoint path or payload envelope. This rebuild
 * POSTs JSON `{instructions, formFile, callbackUrl}` to
 * `<BASESTATION_API_URL>/api/autofill/jobs` with an
 * `Authorization: Bearer <key>` header (the bearer form is
 * likewise a labelled reconstruction).
 *
 * Configuration (all injectable via deps in tests):
 * - `BASESTATION_API_KEY` (required): a missing or empty key
 *   is an honest isError naming the variable — never a fake
 *   job, and no request is made.
 * - `BASESTATION_API_URL`: default
 *   `https://app.hellobasestation.com`.
 * - `MAX_PDF_MB`: default 15. A `formFile` decoding to more
 *   than the limit is refused locally, before any request.
 * - `REQUEST_TIMEOUT_MS`: default 15000, enforced with an
 *   AbortController.
 *
 * Failures surface as isError results: upstream HTTP errors
 * as `formfill error: HTTP <status>` plus the upstream error
 * text when the body carries one; a 2xx response missing any
 * of the pinned return fields is an honest error, not a
 * fabricated job; invalid base64 is rejected locally.
 */
import type {
  CreateAutofillJobArgs,
  FetchFn,
  FetchResponseLike,
  FormfillDeps,
  ToolArgs,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_API_URL = "https://app.hellobasestation.com";
export const DEFAULT_MAX_PDF_MB = 15;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

export const CREATE_AUTOFILL_JOB_TOOL = "basestation.create_autofill_job";

/* ------------------------------------------------------------------ */
/* Tool definition (tools/list literal)                                */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS = [
  {
    name: "basestation.create_autofill_job",
    description: "Creates a BaseStation autofill job for PDF form filling.",
    inputSchema: {
      type: "object" as const,
      properties: {
        callbackUrl: {
          description: "Optional callback URL for job completion notification",
          type: "string",
        },
        formFile: {
          description: "Base64-encoded PDF file to fill",
          type: "string",
        },
        instructions: {
          description: "Natural language instructions for how to fill the form",
          type: "string",
        },
      },
      required: ["instructions", "formFile"],
    },
  },
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/* ------------------------------------------------------------------ */
/* Argument validation                                                 */
/* ------------------------------------------------------------------ */

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

/**
 * Check a call's arguments for shape errors. Returns an error
 * message, or null when the arguments are well-formed. The
 * MCP layer maps a non-null return to McpError InvalidParams;
 * the core and the CLI surface it as an isError result.
 */
export function validateArgs(args: ToolArgs): string | null {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return "arguments must be a JSON object";
  }
  if (!isNonEmptyString(args.instructions)) {
    return "instructions must be a non-empty string";
  }
  if (!isNonEmptyString(args.formFile)) {
    return "formFile must be a non-empty string";
  }
  if (args.callbackUrl !== undefined && typeof args.callbackUrl !== "string") {
    return "callbackUrl must be a string when provided";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Base64 / size guard                                                 */
/* ------------------------------------------------------------------ */

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decode a base64 string strictly. Returns the decoded bytes,
 * or null when the input is not valid base64.
 */
export function decodeBase64(value: string): Buffer | null {
  const compact = value.replace(/\s+/g, "");
  if (compact.length === 0) return null;
  if (compact.length % 4 === 1) return null;
  if (!BASE64_RE.test(compact)) return null;
  const padded = compact + "=".repeat((4 - (compact.length % 4)) % 4);
  const decoded = Buffer.from(padded, "base64");
  // Round-trip check rejects non-canonical encodings Buffer
  // would otherwise silently tolerate.
  if (decoded.toString("base64").replace(/=+$/, "") !== padded.replace(/=+$/, "")) {
    return null;
  }
  return decoded;
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function apiBaseUrl(deps: FormfillDeps): string {
  const env = deps.env ?? process.env;
  if (deps.url && deps.url.trim() !== "") return deps.url.trim().replace(/\/+$/, "");
  const raw = env.BASESTATION_API_URL;
  if (raw && raw.trim() !== "") return raw.trim().replace(/\/+$/, "");
  return DEFAULT_API_URL;
}

function maxPdfMb(deps: FormfillDeps): number {
  if (deps.maxPdfMb !== undefined && Number.isFinite(deps.maxPdfMb) && deps.maxPdfMb > 0) {
    return deps.maxPdfMb;
  }
  return parsePositiveNumber((deps.env ?? process.env).MAX_PDF_MB, DEFAULT_MAX_PDF_MB);
}

function timeoutMs(deps: FormfillDeps): number {
  if (deps.timeoutMs !== undefined && Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0) {
    return deps.timeoutMs;
  }
  return parsePositiveNumber(
    (deps.env ?? process.env).REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
}

/* ------------------------------------------------------------------ */
/* REST client                                                         */
/* ------------------------------------------------------------------ */

function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/** Extract a human-readable error string from an upstream body, if any. */
function upstreamErrorText(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (trimmed === "") return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      for (const key of ["error", "message", "detail"]) {
        const value = record[key];
        if (typeof value === "string" && value !== "") return value;
        if (value !== null && typeof value === "object") {
          const nested = (value as Record<string, unknown>).message;
          if (typeof nested === "string" && nested !== "") return nested;
        }
      }
    }
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return trimmed;
}

const REQUIRED_RESPONSE_FIELDS = ["job_id", "upload_page_url", "instructions_summary"] as const;

/**
 * Create one BaseStation autofill job.
 *
 * Local checks run first, in order: argument shape, base64
 * validity, decoded-size guard, then the API-key check. Only
 * a call passing all of them is sent upstream.
 */
export async function createAutofillJob(
  args: CreateAutofillJobArgs,
  deps: FormfillDeps = {},
): Promise<ToolResult> {
  const rawArgs = (args ?? {}) as unknown as ToolArgs;
  const validationError = validateArgs(rawArgs);
  if (validationError !== null) return errorResult(validationError);

  const decoded = decodeBase64(args.formFile);
  if (decoded === null) {
    return errorResult("formfill error: formFile is not valid base64");
  }

  const limitMb = maxPdfMb(deps);
  const limitBytes = limitMb * 1024 * 1024;
  if (decoded.length > limitBytes) {
    return errorResult(
      `formfill error: formFile decodes to ${decoded.length} bytes, exceeding the MAX_PDF_MB limit of ${limitMb} MB`,
    );
  }

  const env = deps.env ?? process.env;
  const apiKey = env.BASESTATION_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return errorResult(
      "BASESTATION_API_KEY is required: set the BASESTATION_API_KEY environment variable to your BaseStation API key",
    );
  }

  const fetchFn: FetchFn = deps.fetchFn ?? defaultFetch;
  const url = `${apiBaseUrl(deps)}/api/autofill/jobs`;
  const timeout = timeoutMs(deps);

  const body: Record<string, unknown> = {
    instructions: args.instructions,
    formFile: args.formFile,
  };
  if (args.callbackUrl !== undefined) body.callbackUrl = args.callbackUrl;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response: FetchResponseLike;
  let responseText: string;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    responseText = await response.text();
  } catch (err) {
    if (
      controller.signal.aborted ||
      (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"))
    ) {
      return errorResult(`formfill error: request timed out after ${timeout} ms`);
    }
    return errorResult(
      `formfill error: request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status < 200 || response.status >= 300) {
    const detail = upstreamErrorText(responseText);
    return errorResult(
      detail !== null
        ? `formfill error: HTTP ${response.status}: ${detail}`
        : `formfill error: HTTP ${response.status}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return errorResult("formfill error: upstream response was not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return errorResult("formfill error: upstream response was not a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const missing = REQUIRED_RESPONSE_FIELDS.filter(
    (field) => record[field] === undefined || record[field] === null || record[field] === "",
  );
  if (missing.length > 0) {
    return errorResult(
      `formfill error: upstream response missing required field(s): ${missing.join(", ")}`,
    );
  }

  return { content: [{ type: "text", text: JSON.stringify(parsed) }] };
}

/** Dispatch by tool name, for the MCP handler and the CLI. */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: FormfillDeps = {},
): Promise<ToolResult> {
  if (name === CREATE_AUTOFILL_JOB_TOOL) {
    return createAutofillJob(args as unknown as CreateAutofillJobArgs, deps);
  }
  return errorResult(`Unknown tool: ${name}`);
}
