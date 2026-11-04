# formfill

Hand BaseStation a PDF form and a sentence about what goes
in it. formfill creates a BaseStation autofill job: you
describe in plain language how the form should be filled,
attach the form itself as base64, and BaseStation returns a
job ID, an upload page URL, and its parsed summary of your
instructions.

This package is a small API-key REST client for that one
operation, exposed both as an MCP tool and as a CLI command
behind a single bin.

## Configuration

- `BASESTATION_API_KEY` (**required**) — your BaseStation
  API key. Without it every call fails with an error naming
  the variable; no request is made and no job is invented.
- `BASESTATION_API_URL` (optional) — API base URL. Defaults
  to `https://app.hellobasestation.com`.
- `MAX_PDF_MB` (optional) — maximum decoded PDF size, in
  megabytes. Defaults to `15`. A `formFile` decoding to more
  than the limit is refused locally, before any request.
- `REQUEST_TIMEOUT_MS` (optional) — outbound request
  timeout in milliseconds. Defaults to `15000`.

## Tool

- `basestation.create_autofill_job` — creates a BaseStation
  autofill job for PDF form filling.
  - `instructions` (string, required): natural language
    instructions for how to fill the form.
  - `formFile` (string, required): base64-encoded PDF file
    to fill.
  - `callbackUrl` (string, optional): callback URL for job
    completion notification.
  - On success the result is the upstream JSON as JSON text,
    carrying `job_id`, `upload_page_url`, and
    `instructions_summary`.

### How a call flows

1. Arguments are checked locally: required strings present,
   `formFile` valid base64, decoded size within
   `MAX_PDF_MB`, and `BASESTATION_API_KEY` set. Any failure
   is an error result and nothing is sent.
2. A POST goes to the autofill jobs endpoint with a JSON
   body of `{instructions, formFile, callbackUrl}` (the
   callback only when given) and the API key as a bearer
   credential.
3. An upstream HTTP error surfaces as
   `formfill error: HTTP <status>`, plus the upstream error
   text when the body carries one. A 2xx reply that is
   missing `job_id`, `upload_page_url`, or
   `instructions_summary` is reported as an error rather
   than dressed up as a job.

### Provenance

The tool name, parameters, return fields, and configuration
above come from the upstream package's published README.
The endpoint path (`/api/autofill/jobs`) and the
`Authorization: Bearer <key>` header form are a **labelled
reconstruction** — the README pins the tool surface but not
the API's endpoint path or payload envelope.

## CLI

```bash
npx @reneturcios/formfill basestation.create_autofill_job '{"instructions":"Fill in the applicant name as Ada Lovelace","formFile":"<base64-pdf>"}'
npx @reneturcios/formfill --version
```

Output is the tool's result text (the upstream JSON on
success). Exit codes: `0` on success, `1` on an error
result, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/formfill mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "formfill": {
      "command": "npx",
      "args": ["-y", "@reneturcios/formfill", "mcp"],
      "env": {
        "BASESTATION_API_KEY": "<your key>"
      }
    }
  }
}
```

## Docker

```bash
docker run -i -e BASESTATION_API_KEY=<your key> ghcr.io/cloudcorprecords/formfill
docker run --rm -e BASESTATION_API_KEY=<your key> ghcr.io/cloudcorprecords/formfill basestation.create_autofill_job '{"instructions":"...","formFile":"..."}'
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (fake fetch only, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
