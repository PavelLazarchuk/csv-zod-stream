# csv-zod-stream

## 1.1.0

### Minor Changes

- 9e5c715: New options and helpers.

    - `emptyAs: 'undefined' | 'null'` turns blank cells into something `.optional()`, `.nullable()` and `.default()` recognise, instead of an empty string.
    - `checkHeaders` (on by default) reads the header before the first row is validated and fails with a `MissingColumnsError` naming every column the schema cannot do without, instead of failing on row one once per field. Pass an explicit list of columns, or `false`, to steer it.
    - `skipRecordsWithError` routes a record `csv-parse` cannot read through the same channel as an invalid row: it arrives as a `RowParseError` with a physical line number, counts against `maxErrors`, and leaves the positions of the rows behind it intact. Previously any structural error destroyed the stream whatever `onInvalidRow` said.
    - `parse` takes raw `csv-parse` options, so `from_line`, `to_line`, `max_record_size`, `record_delimiter` and the rest are reachable without this package mirroring each one. Named options win when set and fill in from `parse` when not; `delimiter`, `columns`, `info` and `raw` stay the library's.
    - `batched(size)` groups validated rows into arrays, and `parseCsv` / `parseCsvFile` parse a whole small input in one call, returning `{ rows, errors }`. Both builds export `batched` and `parseCsv`; `parseCsvFile` is Node-only.
    - `delimiter: 'auto'` now samples up to five record lines and prefers the candidate that occurs equally often on all of them, so a header carrying a stray separator no longer decides the delimiter on its own. `|` joins the candidates, and the sniffer honours `escape`.
    - `TooManyInvalidRowsError` carries `maxErrors` and `cause`, the row that went over the limit — previously `'skip'` gave an error with an empty `errors` array and nothing else.

    Type change: `errors`, `onRowError` and the `'invalid-row'` event are now typed as `CsvRowError`, the shared base of `RowValidationError` and the new `RowParseError`. Narrow with `instanceof RowValidationError` before reaching for `zodError`.

## 1.0.1

### Patch Changes

- 719ad8a: Fix delimiter sniffing on files with CR-only line endings. The scanner treated
  only LF as a line end, so `delimiter: 'auto'` never found the end of the first
  line: it sampled the whole buffer instead of the header, and skipped neither
  comment nor blank lines ahead of it. A `#`-comment containing commas could win
  the vote over the real delimiter. Affects both the Node and the web build.

    Fix the reported line and `raw` of an invalid row when the parser dropped one of
    its fields — extra columns under `relaxColumnCount`, or duplicate header names.
    Line positions are now read off the record's own text rather than off its parsed
    values, so a dropped field that spans several lines no longer shifts the
    position or truncates `RowValidationError.raw`.

## 1.0.0

### Major Changes

- Initial release.
- TypeScript support.
- Documentation.
