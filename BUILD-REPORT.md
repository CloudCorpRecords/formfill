# formfill — Build Report (Batch 27)

Rebuild of `com.hellobasestation/pdfkit` v1.0.3 (npm
`pdfkit-mcp`, an MCP server over the BaseStation PDF API)
from the firsthand spec in `specs-batch27/formfill.md`.
Built 2026-10-27.

> **⚠ WIRE RECONSTRUCTION — flagged prominently, as the spec
> requires.** The upstream README pins the tool's parameters,
> return fields, and configuration, but NOT the BaseStation
> API's endpoint path, payload envelope, or auth header form
> (those docs live behind the vendor site). This rebuild
> therefore POSTs JSON `{instructions, formFile, callbackUrl}`
> to `<BASESTATION_API_URL>/api/autofill/jobs` with an
> `Authorization: Bearer <key>` header, and expects a JSON
> response carrying the three pinned return fields. Both the
> endpoint path and the bearer form are **labelled
> reconstructions**, also labelled in the fixture `_source`,
> the spec, the README's Provenance section, and the core
> module header. No live call was made or claimed; all tests
> run against a fake fetch only.

## Identity

- npm: `@reneturcios/formfill` @ 0.1.0, bin `formfill` →
  `dist/cli.js`
- MCP Registry name: `io.github.CloudCorpRecords/formfill`
  (matches `package.json` `mcpName`, `server.json` `name`,
  and the Dockerfile `io.modelcontextprotocol.server.name`
  label)
- server.json description (89 chars, verified, exact):
  "Create BaseStation PDF form autofill jobs from
  natural-language instructions via its API."
- server.json: npm package entry carries `"version":
  "0.1.0"`; the OCI entry
  (`ghcr.io/cloudcorprecords/formfill:0.1.0`) carries **no**
  `version` field (verified).

## Files (19-file factory set, per TEMPLATE.md §2)

package.json, server.json, Dockerfile, tsconfig.json
(318 bytes, fleet-identical shape), .gitignore,
package-lock.json, README.md (fresh prose), LICENSE (MIT,
© 2026 Rene Turcios), CHANGELOG.md (single 0.1.0 entry dated
2026-10-27), src/index.ts, src/cli.ts (shebang + exec bit),
src/mcp.ts, src/types.ts, src/formfill.ts (core),
test/formfill.test.ts, and the four workflows under
.github/workflows/ (publish-container adapted: IMAGE
ghcr.io/cloudcorprecords/formfill, smoke assertion on server
name `formfill`). Plus this BUILD-REPORT.md and the
parity-out/ artifacts.

## Implementation

- `src/mcp.ts`: low-level `Server` API
  (`sdk/server/index.js` + `StdioServerTransport`, handlers
  for `ListToolsRequestSchema` / `CallToolRequestSchema` from
  `sdk/types.js`), one explicit JSON-schema literal for the
  single tool; no McpServer/zod registration. Malformed
  arguments throw `McpError` with `ErrorCode.InvalidParams`;
  unknown tools throw MethodNotFound; guard/upstream failures
  return isError results.
- `src/formfill.ts`: `VERSION = "0.1.0"`. API-key REST
  client with injectable fetch and injectable env in the
  core (`FormfillDeps`: `fetchFn`, `env`, plus `url`,
  `maxPdfMb`, `timeoutMs` overrides). Behaviour:
  - Tool `basestation.create_autofill_job` with
    `instructions` (string, required), `formFile` (string,
    required, base64 PDF), `callbackUrl` (string, optional).
    Success returns the upstream JSON — carrying `job_id`,
    `upload_page_url`, `instructions_summary` — as JSON text.
  - `BASESTATION_API_KEY` required: a missing/empty key is an
    honest isError naming the variable, no request, never a
    fake job. `BASESTATION_API_URL` defaults to
    `https://app.hellobasestation.com` (trailing slash
    stripped). `REQUEST_TIMEOUT_MS` defaults to 15000 and is
    enforced with an AbortController whose signal is passed
    to fetch.
  - Local guards, in order, all before any request: argument
    shape; strict base64 validity (round-trip checked);
    decoded-size guard — `MAX_PDF_MB` defaults to 15 and an
    oversize `formFile` is refused with an error naming the
    `MAX_PDF_MB` limit and its value.
  - Upstream HTTP errors return `formfill error: HTTP
    <status>`, plus `: <upstream error text>` when the body
    carries one (a JSON `error` / `message` / `detail` field,
    else the raw body text). A 2xx response that is not a
    JSON object, or that is missing any of the three pinned
    fields, is an honest error. A throwing fetch becomes
    `formfill error: request failed: <message>`; an abort
    becomes `formfill error: request timed out after <ms> ms`.
- CLI: `formfill basestation.create_autofill_job '<json>'`,
  `formfill mcp` (stdio), `formfill --version` → `0.1.0`;
  unknown subcommand → usage on stderr, exit 2; isError
  results exit 1 (both spot-checked against the built CLI).

## Verification (all real, run 2026-10-27)

- `npx tsc --noEmit`: exit 0. `npm run build` (tsc): exit 0.
- `npm test`: **30 tests, 30 pass, 0 fail** — fake fetch
  only, no live network. Covers success passthrough of the
  three pinned fields, the wire shape (URL, POST, bearer
  header, JSON body, AbortSignal present), callbackUrl
  present/omitted, `BASESTATION_API_URL` override, missing
  and empty key errors naming `BASESTATION_API_KEY` with
  zero fetches, oversize `formFile` refused with zero fetches
  (via both env `MAX_PDF_MB` and the deps override) naming
  the limit, invalid base64 rejected with zero fetches,
  HTTP 402 and 500 → `formfill error: HTTP <status>` with
  upstream text, empty-body HTTP error, 2xx missing-fields
  and non-JSON honest errors, throwing-fetch mapping, the
  timeout path (fake fetch rejecting on the AbortSignal,
  via both the deps override and env `REQUEST_TIMEOUT_MS`),
  malformed-args validation, a live stdio MCP test asserting
  malformed args return JSON-RPC **-32602** (InvalidParams),
  registration deep-equality with the fixture, and CLI cases
  (--version, unknown subcommand exit 2, non-JSON and array
  arguments exit 2, extra `mcp` argument exit 2, missing-key
  exit 1, malformed-args exit 1).
- `node dist/cli.js --version`: prints `0.1.0`. Unknown
  subcommand exits 2 with usage; a missing-key call exits 1.
- Parity: `harness/parity.py` with the original as
  tools-file (`harness/fixtures/pdfkit-tools-original.json`)
  and the rebuild as live stdio → **PASS, parity 100.0,
  identical_tools 1 / total 1** (see `parity-out/parity.json`;
  fixture_results SKIPPED-TOOLS-FILE-MODE, as expected).
- Lockfile (Route 3, clean from birth): generated in a temp
  dir containing only `package.json` with
  `npm install --package-lock-only --ignore-scripts
  --offline`; verified it parses, `name` ==
  `@reneturcios/formfill`, lockfileVersion 3, **128 package
  entries**; copied in as `package-lock.json`, then
  `npm install --offline --ignore-scripts` in the build dir
  succeeded for node_modules.
- Version consistency: `package.json` 0.1.0 = `server.json`
  top-level 0.1.0 = npm entry 0.1.0 = OCI tag `:0.1.0` =
  core `VERSION` 0.1.0 = CHANGELOG heading
  `## 0.1.0 (2026-10-27)`.

## Ambiguities flagged

1. **Wire reconstruction (the big one, above):** endpoint
   path `/api/autofill/jobs`, the JSON payload envelope, and
   the `Authorization: Bearer <key>` form are reconstructions
   — the README pins none of them. If the real BaseStation
   API differs, only `src/formfill.ts`'s request construction
   changes; the tool surface is pinned and unaffected.
2. **Upstream error-text extraction:** the spec says HTTP
   errors surface as `formfill error: HTTP <status>` "plus
   the upstream error text when present" without pinning a
   body shape. This build reads a JSON `error`, `message`,
   or `detail` field (or a nested `message`), else the raw
   body text, joined as `formfill error: HTTP <status>:
   <text>`.
3. **Pinned-field check:** a 2xx field counts as present
   only when it is non-null and non-empty. A numeric
   `job_id` would pass; an empty string would be reported
   missing. The spec does not pin field types.
4. **`callbackUrl` when absent** is omitted from the request
   body rather than sent as `null` — the envelope is a
   reconstruction either way (see 1).
5. **Invalid config values:** a non-numeric or non-positive
   `MAX_PDF_MB` / `REQUEST_TIMEOUT_MS` falls back to the
   pinned defaults (15 / 15000) instead of erroring; the spec
   does not pin invalid-value behaviour.
6. **Empty-string required arguments** (`instructions: ""`)
   are treated as malformed (InvalidParams at the MCP layer)
   rather than forwarded; the spec pins them as required
   strings without addressing empties.
