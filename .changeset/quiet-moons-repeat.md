---
'csv-zod-stream': minor
---

Header checks now run on a file that has no data rows, and column suggestions no longer point at a column that already matched.

- `checkHeaders` and `unknownColumns` only ever saw the columns carried on the first record, so a file that was nothing but a header row — or one whose every record was skipped under `skipRecordsWithError` — went through without a word, however wrong its columns were. The header is now read as the parser resolves it, and a file that ends without a single record is still checked before the stream finishes. A completely empty file has no header to check and stays quiet, as before.

    This is the behaviour change to watch: a header-only file with the wrong columns now fails with `MissingColumnsError` or `UnknownColumnsError` where it used to resolve with no rows.

- `MissingColumnsError.suggestions` measured a missing column against every column in the file, including the ones the schema had already matched, and `UnknownColumnsError` did the mirror image. A file of `a,bb` against `{ a, b }` was told `did you mean "a" for "b"` — a column it was already using. Each side now only offers what is still unclaimed, so the same file suggests `"bb"`, and an unknown column with nothing left to match keeps quiet.

- A fractional `keepErrors` — `2.5` — kept three errors and then indexed its ring buffer at `0.5`. It is now floored, so the cap is honoured.
