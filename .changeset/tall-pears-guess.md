---
'csv-zod-stream': minor
---

Five options and one helper aimed at real import files.

- `async: true` validates with `safeParseAsync`, so a schema can await a lookup in a refinement or a transform. Rows are still judged one at a time in file order and the reader stops while one is in flight, so backpressure holds instead of a million promises queueing up. A rejected promise fails the stream; an issue the refinement reports is an ordinary invalid row and obeys `onInvalidRow`. Without the option an async schema still fails with zod's own complaint about a synchronous parse.
- `normalizeHeaders` folds the header row before anything else reads it — `'trim'`, `'lower'`, `'snake'`, `'camel'` or a function. `'camel'` and `'snake'` split on non-alphanumerics and on camelCase boundaries, so `First Name `, `userID` and `User ID` reach the schema as `firstName` / `first_name`. Letters outside ASCII are letters: `Имя` folds to `имя`.
- `columnAliases` renames what folding cannot reach — `{ 'E-Mail': 'email' }`. An alias is looked up against the header as it appears in the file first, then against its normalized form. Both options apply to an explicit `headers` array, and `MissingColumnsError` reports the renamed columns.
- `encoding` decodes the bytes on the way in through `TextDecoder`, so `windows-1251`, `windows-1252`, `latin1`, `koi8-r` and the rest of the WHATWG set parse without a transcoding step. Decoding is streaming, so a character split across two chunks survives, and it happens before the delimiter sniffer and `csv-parse`. A leading BOM is stripped unless `bom: false`; a string handed to `parseCsv` is left alone.
- `withMeta: true` emits `{ row, line, record }` instead of the row, carrying the same two numbers a `RowValidationError` does. It works through `batched()`, the one-shot helpers and the web build, the row type follows as `CsvRow<T>`, and it also gets a schema whose output is `null` through a Node stream.
- `rejectsCsv(errors)` renders collected row errors as the rejects file an import is expected to hand back — `line,record,error,code,field,message,raw`, with `delimiter`, `eol`, `header` and a `bom` flag for Excel. Exported from both builds.
