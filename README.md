# csv-zod-stream

[![npm version](https://img.shields.io/npm/v/csv-zod-stream.svg)](https://www.npmjs.com/package/csv-zod-stream)
[![npm downloads](https://img.shields.io/npm/dm/csv-zod-stream.svg)](https://www.npmjs.com/package/csv-zod-stream)

Streaming CSV/TSV parsing with per-row [Zod](https://zod.dev) validation — a real Node.js `Transform` on top of [`csv-parse`](https://csv.js.org/parse/), plus a Web Streams build for Deno, Bun and edge runtimes.

```ts
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { createCsvValidator } from 'csv-zod-stream';

const Employee = z.object({
    id: z.coerce.number().int().positive(),
    name: z.string().min(1),
    email: z.email(),
    salary: z.coerce.number().int(),
});

await pipeline(
    createReadStream('employees.csv'),
    createCsvValidator(Employee),
    async function (rows) {
        for await (const employee of rows) await save(employee);
    }
);
```

- **Backpressure that reaches the file handle.** A slow consumer stops the reader, not the heap.
- **A real `Transform`**, so `.pipe()`, `pipeline()` and `for await` all work as you expect.
- **Physical line numbers on errors**, correct even when records span several lines.
- **CSV, TSV and semicolon files**, with an optional first-line sniffer.
- **`csv-parse` under the hood** — quoting, escaping, BOM and CRLF are its problem, not a hand-rolled parser's.
- **Zod v4**, typed end to end: the row type is inferred from the schema, after coercion.

## Install

```sh
npm install csv-zod-stream zod
```

Node ≥ 20. `zod` is a peer dependency; `csv-parse` comes along as a dependency.

## Why not `zod-csv`?

[`zod-csv`](https://www.npmjs.com/package/zod-csv) is the closest package on npm, and its `processCSVInChunks` covers the same ground. The differences are architectural:

|                          | `zod-csv`                                     | `csv-zod-stream`                         |
| ------------------------ | --------------------------------------------- | ---------------------------------------- |
| Parser                   | `csv-string`, driven by hand-written chunking | `csv-parse`                              |
| API                      | custom event emitter (`.on` / `.write`)       | `stream.Transform`                       |
| `.pipe()` / `pipeline()` | no                                            | yes                                      |
| Backpressure             | not part of the design                        | end to end, [with a test](#backpressure) |
| TSV / semicolon          | not offered                                   | built in, plus `delimiter: 'auto'`       |
| Web Streams              | no                                            | `csv-zod-stream/web`                     |
| Zod                      | `^3.11`                                       | v4                                       |

If you want a browser `File` helper or a one-shot "parse this small string" API, `zod-csv` has those and this package deliberately does not.

## Backpressure

Rows leave the parser only while the readable side has room for them. Stop reading and the pull loop stops, `csv-parse` fills up, its writes start returning `false`, and the upstream chunk callback is withheld — so a slow consumer throttles the file read instead of filling the heap.

`npm run bench` (500 000 rows, 8.3 MB, a consumer that yields every 1 000 rows):

```
    50000     7.9 MB  ██████████████████████████████████
   100000     9.3 MB  ████████████████████████████████████████
   150000     7.8 MB  ██████████████████████████████████
   200000     8.0 MB  ███████████████████████████████████
   250000     8.2 MB  ███████████████████████████████████
   300000     8.4 MB  ████████████████████████████████████
   350000     8.6 MB  █████████████████████████████████████
   400000     8.7 MB  ██████████████████████████████████████
   450000     8.9 MB  ██████████████████████████████████████
   500000     7.8 MB  █████████████████████████████████
```

Flat, not linear. The test suite asserts the same thing without measuring the heap: over a million rows, the producer never gets more than a couple of chunks ahead of the consumer.

## Invalid rows

`onInvalidRow` decides what a row the schema rejects does to the stream.

### `'error'` (default) — stop at the first one

```ts
try {
    await pipeline(createReadStream('employees.csv'), createCsvValidator(Employee), sink);
} catch (error) {
    if (error instanceof RowValidationError) {
        console.error(`line ${error.line}: ${error.message}`);
        console.error(error.raw);
    }
}
```

The stream is destroyed immediately, so rows still sitting in its buffer are dropped. Use `'skip'` or `'collect'` when you need everything up to the failure.

### `'skip'` — drop it and carry on

```ts
const rows = createCsvValidator(Employee, { onInvalidRow: 'skip' });

rows.on('invalid-row', error => log.warn(`skipped line ${error.line}`, error.zodError.issues));
```

### `'collect'` — drop it, and keep it for later

```ts
const rows = createCsvValidator(Employee, { onInvalidRow: 'collect', maxErrors: 100 });

await pipeline(createReadStream('employees.csv'), rows, sink);

for (const error of rows.errors) console.log(error.line, error.zodError.issues);
```

`maxErrors` is how many invalid rows to tolerate; the next one destroys the stream with a `TooManyInvalidRowsError` carrying everything collected so far. It applies to `'skip'` as well.

Anything thrown while a row is being judged — an `onRowError` that throws, a `.transform()` that throws, a schema with an async refinement that needs `safeParseAsync` — fails the stream with that error instead of escaping as an uncaught exception.

### `RowValidationError`

```ts
class RowValidationError extends Error {
    line: number; // physical line the record starts on
    record: number; // index among the data rows
    raw: string; // the record as it appeared in the file
    zodError: ZodError;
}
```

`line` is a file position, not a record count. Records holding multiline quoted fields push the two apart, which is exactly when a line number is worth having. Blank lines, comment lines and CRLF endings — including a CRLF inside a quoted field — are all accounted for. `raw` is the record's own text: the lines skipped ahead of it and its trailing line break are cut off.

## Delimiters

`delimiter` takes any separator string, or `'auto'`:

```ts
createCsvValidator(Employee, { delimiter: '\t' });
createCsvValidator(Employee, { delimiter: 'auto' });
```

`'auto'` buffers up to the end of the first line that is neither blank nor a comment (when `comment` is set), skipping anything inside quotes, and picks whichever of `,`, `\t` or `;` appears most often on it. It honours `quote`. It is a heuristic: ties and single-column files fall back to `,`, and a file whose header disagrees with its body will fool it. Name the delimiter when you know it.

## Web Streams

`csv-zod-stream/web` is the same validator over `TransformStream`, with no Node stream machinery in the bundle:

```ts
import { createCsvValidator } from 'csv-zod-stream/web';

const response = await fetch('https://example.com/employees.csv');

for await (const employee of response.body.pipeThrough(createCsvValidator(Employee))) {
    await save(employee);
}
```

Backpressure comes from `pipeThrough` itself — nothing is pulled out of the parser until the consumer asks for the next row.

There is no `EventEmitter` here, so pass `onRowError` instead of listening for `'invalid-row'`; `.errors` works the same as on the Node build.

```ts
const validator = createCsvValidator(Employee, {
    onInvalidRow: 'collect',
    onRowError: error => log.warn(error.line, error.message),
});
```

This build reaches Web Streams through `csv-parse/stream`, which imports them from `node:stream/web`. Node, Deno, Bun and edge runtimes with Node compatibility resolve that; a plain browser bundle needs your bundler to alias `node:stream/web` to the platform globals.

## Options

| Option             | Default    | Meaning                                                                 |
| ------------------ | ---------- | ----------------------------------------------------------------------- |
| `delimiter`        | `','`      | Field separator, or `'auto'` to sniff the first meaningful line         |
| `headers`          | `true`     | `true` reads names from the first row; an array names a headerless file |
| `onInvalidRow`     | `'error'`  | `'error'` \| `'skip'` \| `'collect'`                                    |
| `maxErrors`        | `Infinity` | Invalid rows tolerated under `'skip'` / `'collect'`                     |
| `onRowError`       | —          | Called for each invalid row under `'skip'` / `'collect'`                |
| `bom`              | `true`     | Strip a leading UTF-8 BOM                                               |
| `skipEmptyLines`   | `true`     | Ignore blank lines rather than treating them as records                 |
| `relaxColumnCount` | `false`    | Let ragged rows through so the schema judges them                       |
| `trim`             | `false`    | Trim whitespace around unquoted fields                                  |
| `quote`            | `'"'`      | Quote character                                                         |
| `escape`           | `'"'`      | Escape character inside quoted fields                                   |
| `comment`          | —          | Ignore lines starting with this character                               |

A record whose shape is structurally broken — the wrong number of fields, an unterminated quote — is a parse error, not a validation error: it destroys the stream regardless of `onInvalidRow`. Turn on `relaxColumnCount` to hand ragged rows to the schema instead.

## Not in v1

Async validation (`safeParseAsync`), CSV generation from objects, and a browser `File` helper are all out of scope for now.

## License

MIT © Pavel Lazarchuk
