# Changelog

## 0.1.0 (2026-10-27)

- Initial release: one MCP tool, `basestation.create_autofill_job`,
  and the matching CLI subcommand, creating BaseStation PDF form
  autofill jobs from natural-language instructions and a
  base64-encoded PDF.
- API-key REST client: `BASESTATION_API_KEY` is required (a missing
  key is an honest error naming the variable, never a fake job),
  `BASESTATION_API_URL` defaults to
  `https://app.hellobasestation.com`, `MAX_PDF_MB` defaults to 15
  (decoded-size guard refused locally before any request), and
  `REQUEST_TIMEOUT_MS` defaults to 15000.
- The endpoint path and bearer header are a labelled reconstruction:
  POST `{BASESTATION_API_URL}/api/autofill/jobs` with a JSON body of
  `{instructions, formFile, callbackUrl}` and an
  `Authorization: Bearer <key>` header.
