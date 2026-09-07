---
'csv-zod-stream': minor
---

Bound the invalid-row buffer and fail fast on bad options.

- `keepErrors` (default `1000`) caps how many invalid rows are held in memory under `'collect'`; past it the oldest is dropped and the new `droppedErrors` counter — on the stream and on the `parseCsv` / `parseCsvFile` result — says how many. Pass `Infinity` for the previous unbounded behaviour.
- `TooManyInvalidRowsError.errors` now carries the rows kept in that window under `'skip'` too, instead of always being empty there. `stream.errors` still stays empty under `'skip'`.
- `emptyAs`, `onInvalidRow`, `maxErrors`, `keepErrors`, `delimiter`, `headers` and `normalizeHeaders` are validated in `createCsvValidator` itself, so a typo throws a `RangeError` at construction rather than being ignored or surfacing mid-file.
