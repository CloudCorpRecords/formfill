/**
 * formfill types.
 *
 * One tool, `basestation.create_autofill_job`, backed by an
 * API-key REST call to the BaseStation PDF autofill API. The
 * caller supplies natural-language instructions and a
 * base64-encoded PDF; a successful call returns the upstream
 * JSON (job_id, upload_page_url, instructions_summary)
 * serialized as JSON text.
 */

export interface CreateAutofillJobArgs {
  instructions: string;
  formFile: string;
  callbackUrl?: string;
}

/** A tool's arguments, as decoded JSON. */
export type ToolArgs = Record<string, unknown>;

/** The result shape shared by the MCP handler and the CLI. */
export interface ToolResult {
  content: unknown;
  isError?: boolean;
}

/** The minimal slice of a fetch Response this client relies on. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Injectable fetch, so tests never touch the live network. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/** Runtime dependencies for the core, all injectable in tests. */
export interface FormfillDeps {
  /** Fetch implementation. Defaults to the global fetch. */
  fetchFn?: FetchFn;
  /** Environment (BASESTATION_API_KEY, BASESTATION_API_URL, MAX_PDF_MB, REQUEST_TIMEOUT_MS). Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** API base URL override. Defaults to env BASESTATION_API_URL or the pinned default. */
  url?: string;
  /** Decoded PDF size limit in MB override. Defaults to env MAX_PDF_MB or 15. */
  maxPdfMb?: number;
  /** Request timeout in ms override. Defaults to env REQUEST_TIMEOUT_MS or 15000. */
  timeoutMs?: number;
}
