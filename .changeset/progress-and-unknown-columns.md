---
'csv-zod-stream': minor
---

Progress counters, and the other half of the header check.

- Every stream now carries `stats`: `{ bytes, records, valid, invalid, dropped }`, a fresh snapshot on each read, on the Node stream, the Web Streams build and the `parseCsv` / `parseCsvFile` result. With `fs.stat().size` that is a percentage without a line of bookkeeping.
- New `onProgress(stats)` pushes the same counters instead of being polled, throttled by `progressEveryRecords` (default `1000`) and, if you name one, `progressEveryBytes`. It fires once more at the end of the stream with the final counts, and not at all for a file with no records. A callback that throws fails the stream, the way `onRowError` does, rather than escaping the parse.
- New `unknownColumns: 'ignore' | 'warn' | 'error'` (default `'ignore'`) catches the mirror image of a missing column: a header the schema does not define. `'error'` throws `UnknownColumnsError` — carrying `unknown` and `columns` — before the first row, exactly like `MissingColumnsError`.
- Both header errors now carry `suggestions`, a `{ wanted: found }` map of the closest name on the other side, and say it in the message: `missing column email — the file has name, emial — did you mean "emial" for "email"?`. Matching folds case and treats a swap of two neighbouring letters as one edit, which is the typo that used to read as a data problem.

The root entry grows to 6.29 kB gzipped and the web entry to 5.81 kB.
