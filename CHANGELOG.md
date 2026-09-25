# csv-zod-stream

## 2.1.2

### Patch Changes

- 18aebed: Fix header aliasing, error snapshots and header option validation

    - `columnAliases` no longer resolves a header named after an `Object.prototype` member, such as `constructor` or `toString`, to the inherited function, which made the parser reject the header row.
    - `errors` and `TooManyInvalidRowsError.errors` now return a snapshot instead of the live buffer, so an array read mid-stream no longer changes under the caller as more rows are rejected.
    - `headers` that is neither `true` nor an array, and `checkHeaders` that is neither a boolean nor an array of names, now throw a `RangeError` from `createCsvValidator` instead of failing later with a `TypeError`.

## 2.1.1

### Patch Changes

- 41ff68d: An empty file stays quiet under an explicit `headers` array, as it already did under `headers: true`.

    The end-of-file header check introduced in 2.1.0 saw the columns of an explicit `headers: ['name', ...]` list as soon as the parser was built, so a completely empty input failed with `MissingColumnsError` — or `UnknownColumnsError`, or a spurious `unknownColumns: 'warn'` warning — where it used to resolve with no rows. The check now waits until the file has produced something: a header the parser read, a record, or a record it skipped.

## 2.1.0

### Minor Changes

- bc24054: Header checks now run on a file that has no data rows, and column suggestions no longer point at a column that already matched.

    - `checkHeaders` and `unknownColumns` only ever saw the columns carried on the first record, so a file that was nothing but a header row — or one whose every record was skipped under `skipRecordsWithError` — went through without a word, however wrong its columns were. The header is now read as the parser resolves it, and a file that ends without a single record is still checked before the stream finishes. A completely empty file has no header to check and stays quiet, as before.

        This is the behaviour change to watch: a header-only file with the wrong columns now fails with `MissingColumnsError` or `UnknownColumnsError` where it used to resolve with no rows.

    - `MissingColumnsError.suggestions` measured a missing column against every column in the file, including the ones the schema had already matched, and `UnknownColumnsError` did the mirror image. A file of `a,bb` against `{ a, b }` was told `did you mean "a" for "b"` — a column it was already using. Each side now only offers what is still unclaimed, so the same file suggests `"bb"`, and an unknown column with nothing left to match keeps quiet.

    - A fractional `keepErrors` — `2.5` — kept three errors and then indexed its ring buffer at `0.5`. It is now floored, so the cap is honoured.

## 2.0.0

### Major Changes

- c30c4a2: Any Standard Schema, not only Zod.

    The package never did more with a schema than validate one row, which is exactly the [Standard Schema](https://standardschema.dev) contract. It now accepts anything that implements it — Zod 3.24+, Zod 4, `zod/mini`, Valibot, ArkType — with the same types, the same errors and no adapter. Zod is still first: it is taken through `safeParse`, so a real `ZodError` is still on the row error, and nothing about a Zod call site changes.

    **Breaking:**

    - `RowValidationError.zodError` is now `ZodError | undefined` — `undefined` when the schema was not Zod. The new `RowValidationError.issues` — `{ path, message }[]` — is filled in whatever the schema, and is what `rejectsCsv` now reads for its `field` column. Code that reaches straight for `error.zodError.issues` needs a check, or a move to `error.issues`.
    - The schema type parameter is `StandardSchemaV1` rather than `ZodType`, and the row type comes from `StandardSchemaV1.InferOutput`. Inference for a Zod schema is unchanged; a function that was generic over `ZodType` may need its own bound widened.
    - The `zod` peer range is now `^3.24.0 || ^4.0.0`. Zod 3.24 is the release that added `~standard`, so it is the oldest version the types can accept.
    - `zod` is now an _optional_ peer dependency, and no type in the published `.d.ts` imports from it: `zodError` is typed structurally as `ZodErrorLike`. A caller who wants `ZodError`'s own methods can cast.
    - `createCsvValidator`, `parseCsv` and `parseCsvFile` throw a `TypeError` when handed something that is neither a Zod schema nor a Standard Schema, instead of failing on the first row.

    **Also:**

    - A schema that validates asynchronously is awaited whether or not `async` is set. The option still means "take Zod's `safeParseAsync` route".
    - The header check reads `entries` as well as `shape`, so `zod/mini` and Valibot object schemas get missing-column and unknown-column checking too. A schema whose fields cannot be asked about synchronously is left alone, as before.

    The root entry grows to 6.66 kB gzipped and the web entry to 6.2 kB.

### Minor Changes

- c30c4a2: Progress counters, and the other half of the header check.

    - Every stream now carries `stats`: `{ bytes, records, valid, invalid, dropped }`, a fresh snapshot on each read, on the Node stream, the Web Streams build and the `parseCsv` / `parseCsvFile` result. With `fs.stat().size` that is a percentage without a line of bookkeeping.
    - New `onProgress(stats)` pushes the same counters instead of being polled, throttled by `progressEveryRecords` (default `1000`) and, if you name one, `progressEveryBytes`. It fires once more at the end of the stream with the final counts, and not at all for a file with no records. A callback that throws fails the stream, the way `onRowError` does, rather than escaping the parse.
    - New `unknownColumns: 'ignore' | 'warn' | 'error'` (default `'ignore'`) catches the mirror image of a missing column: a header the schema does not define. `'error'` throws `UnknownColumnsError` — carrying `unknown` and `columns` — before the first row, exactly like `MissingColumnsError`.
    - Both header errors now carry `suggestions`, a `{ wanted: found }` map of the closest name on the other side, and say it in the message: `missing column email — the file has name, emial — did you mean "emial" for "email"?`. Matching folds case and treats a swap of two neighbouring letters as one edit, which is the typo that used to read as a data problem.

    The root entry grows to 6.29 kB gzipped and the web entry to 5.81 kB.

## 1.4.0

### Minor Changes

- 4812f5e: Bound the invalid-row buffer and fail fast on bad options.

    - `keepErrors` (default `1000`) caps how many invalid rows are held in memory under `'collect'`; past it the oldest is dropped and the new `droppedErrors` counter — on the stream and on the `parseCsv` / `parseCsvFile` result — says how many. Pass `Infinity` for the previous unbounded behaviour.
    - `TooManyInvalidRowsError.errors` now carries the rows kept in that window under `'skip'` too, instead of always being empty there. `stream.errors` still stays empty under `'skip'`.
    - `emptyAs`, `onInvalidRow`, `maxErrors`, `keepErrors`, `delimiter`, `headers` and `normalizeHeaders` are validated in `createCsvValidator` itself, so a typo throws a `RangeError` at construction rather than being ignored or surfacing mid-file.

## 1.3.0

### Minor Changes

- e2d9e9d: Five options and one helper aimed at real import files.

    - `async: true` validates with `safeParseAsync`, so a schema can await a lookup in a refinement or a transform. Rows are still judged one at a time in file order and the reader stops while one is in flight, so backpressure holds instead of a million promises queueing up. A rejected promise fails the stream; an issue the refinement reports is an ordinary invalid row and obeys `onInvalidRow`. Without the option an async schema still fails with zod's own complaint about a synchronous parse.
    - `normalizeHeaders` folds the header row before anything else reads it — `'trim'`, `'lower'`, `'snake'`, `'camel'` or a function. `'camel'` and `'snake'` split on non-alphanumerics and on camelCase boundaries, so `First Name `, `userID` and `User ID` reach the schema as `firstName` / `first_name`. Letters outside ASCII are letters: `Имя` folds to `имя`.
    - `columnAliases` renames what folding cannot reach — `{ 'E-Mail': 'email' }`. An alias is looked up against the header as it appears in the file first, then against its normalized form. Both options apply to an explicit `headers` array, and `MissingColumnsError` reports the renamed columns.
    - `encoding` decodes the bytes on the way in through `TextDecoder`, so `windows-1251`, `windows-1252`, `latin1`, `koi8-r` and the rest of the WHATWG set parse without a transcoding step. Decoding is streaming, so a character split across two chunks survives, and it happens before the delimiter sniffer and `csv-parse`. A leading BOM is stripped unless `bom: false`; a string handed to `parseCsv` is left alone.
    - `withMeta: true` emits `{ row, line, record }` instead of the row, carrying the same two numbers a `RowValidationError` does. It works through `batched()`, the one-shot helpers and the web build, the row type follows as `CsvRow<T>`, and it also gets a schema whose output is `null` through a Node stream.
    - `rejectsCsv(errors)` renders collected row errors as the rejects file an import is expected to hand back — `line,record,error,code,field,message,raw`, with `delimiter`, `eol`, `header` and a `bom` flag for Excel. Exported from both builds.

## 1.2.1

### Patch Changes

- 5a5d0bc: Fix three edge cases and document `comment` accurately.

    - A schema whose output is `null` no longer cuts the Node stream short. `push(null)` is
      end-of-stream in object mode, so such a row ended the run — silently, or with
      `ERR_STREAM_PUSH_AFTER_EOF` behind it. It now fails with a `TypeError` that says so.
    - The delimiter sniffer no longer mistakes a stray `0xef`, `0xbb` or `0xbf` byte for a BOM.
      Only a whole BOM at the very front of the input is skipped, so a first field starting with
      a multi-byte character keeps all of its bytes in the sample.
    - `parseCsv` and `parseCsvFile` fall back to `onInvalidRow: 'collect'` when the option is
      present but `undefined`, instead of reverting to `'error'`.
    - README: `comment` opens a comment wherever it appears outside a quoted field, which is
      `csv-parse`'s behaviour, not only at the start of a line. `parse: { comment_no_infix: true }`
      restricts it to line starts.

## 1.2.0

### Minor Changes

- e1b009c: Accept zod 3 as well as zod 4. The peer range widens to `^3.20.0 || ^4.0.0`, so a project already on zod 3 installs without an `ERESOLVE` conflict and keeps the version it has, while a fresh install still resolves to v4. Nothing in `src` used a v4-only API — the library only ever calls `safeParse` and reads `error.issues` — so this is a range change plus a CI job that runs the suite against zod 3.20.

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
