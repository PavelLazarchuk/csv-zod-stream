---
'csv-zod-stream': patch
---

An empty file stays quiet under an explicit `headers` array, as it already did under `headers: true`.

The end-of-file header check introduced in 2.1.0 saw the columns of an explicit `headers: ['name', ...]` list as soon as the parser was built, so a completely empty input failed with `MissingColumnsError` — or `UnknownColumnsError`, or a spurious `unknownColumns: 'warn'` warning — where it used to resolve with no rows. The check now waits until the file has produced something: a header the parser read, a record, or a record it skipped.
