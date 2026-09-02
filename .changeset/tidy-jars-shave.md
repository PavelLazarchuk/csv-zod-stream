---
'csv-zod-stream': minor
---

New options and helpers.

- `emptyAs: 'undefined' | 'null'` turns blank cells into something `.optional()`, `.nullable()` and `.default()` recognise, instead of an empty string.
- `checkHeaders` (on by default) reads the header before the first row is validated and fails with a `MissingColumnsError` naming every column the schema cannot do without, instead of failing on row one once per field. Pass an explicit list of columns, or `false`, to steer it.
- `skipRecordsWithError` routes a record `csv-parse` cannot read through the same channel as an invalid row: it arrives as a `RowParseError` with a physical line number, counts against `maxErrors`, and leaves the positions of the rows behind it intact. Previously any structural error destroyed the stream whatever `onInvalidRow` said.
- `parse` takes raw `csv-parse` options, so `from_line`, `to_line`, `max_record_size`, `record_delimiter` and the rest are reachable without this package mirroring each one. Named options win when set and fill in from `parse` when not; `delimiter`, `columns`, `info` and `raw` stay the library's.
- `batched(size)` groups validated rows into arrays, and `parseCsv` / `parseCsvFile` parse a whole small input in one call, returning `{ rows, errors }`. Both builds export `batched` and `parseCsv`; `parseCsvFile` is Node-only.
- `delimiter: 'auto'` now samples up to five record lines and prefers the candidate that occurs equally often on all of them, so a header carrying a stray separator no longer decides the delimiter on its own. `|` joins the candidates, and the sniffer honours `escape`.
- `TooManyInvalidRowsError` carries `maxErrors` and `cause`, the row that went over the limit — previously `'skip'` gave an error with an empty `errors` array and nothing else.

Type change: `errors`, `onRowError` and the `'invalid-row'` event are now typed as `CsvRowError`, the shared base of `RowValidationError` and the new `RowParseError`. Narrow with `instanceof RowValidationError` before reaching for `zodError`.
