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
- **CSV, TSV, semicolon and pipe files**, with an optional delimiter sniffer.
- **Blank cells that behave**, so `.optional()` and `.nullable()` work without a `preprocess` in every schema.
- **`csv-parse` under the hood** — quoting, escaping, BOM and CRLF are its problem, not a hand-rolled parser's.
- **Zod v4 or v3**, typed end to end: the row type is inferred from the schema, after coercion.

## Install

```sh
npm install csv-zod-stream zod
```

Node ≥ 20. `zod` is a peer dependency — `^3.20.0 || ^4.0.0`, so a project already on zod 3
keeps it and a fresh install gets v4. `csv-parse` comes along as a dependency.

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

`maxErrors` is how many invalid rows to tolerate; the next one destroys the stream with a `TooManyInvalidRowsError`. It carries `count`, `maxErrors`, `errors` (everything collected so far — empty under `'skip'`, which keeps nothing by design) and `cause`, the row that went over the line. It applies to `'skip'` as well.

Anything thrown while a row is being judged — an `onRowError` that throws, a `.transform()` that throws, a schema with an async refinement that needs `safeParseAsync` — fails the stream with that error instead of escaping as an uncaught exception.

### Row errors

`errors`, `onRowError` and the `'invalid-row'` event all carry a `CsvRowError`: either a `RowValidationError`, from a row the schema rejected, or a `RowParseError`, from a record `csv-parse` could not read (see [structural errors](#structural-errors)).

```ts
abstract class CsvRowError extends Error {
    line: number; // physical line the record starts on
    raw: string; // the record as it appeared in the file
}

class RowValidationError extends CsvRowError {
    record: number; // index among the data rows
    zodError: ZodError;
}

class RowParseError extends CsvRowError {
    code: string; // the csv-parse error code
    cause: Error;
}
```

Narrow with `instanceof` before reaching for `zodError`:

```ts
for (const error of rows.errors) {
    if (error instanceof RowValidationError) console.log(error.line, error.zodError.issues);
    else console.log(error.line, error.code);
}
```

`line` is a file position, not a record count. Records holding multiline quoted fields push the two apart, which is exactly when a line number is worth having. Blank lines, comment lines and CRLF endings — including a CRLF inside a quoted field — are all accounted for. `raw` is the record's own text: the lines skipped ahead of it and its trailing line break are cut off.

## Blank cells

A blank cell is an empty string, which is not what `.optional()` or `.nullable()` are waiting for. `emptyAs` translates:

```ts
const Employee = z.object({
    id: z.coerce.number(),
    nickname: z.string().optional(),
    manager: z.string().nullable(),
});

createCsvValidator(Employee, { emptyAs: 'undefined' }); // '' -> undefined
createCsvValidator(Employee, { emptyAs: 'null' }); // '' -> null
```

`'undefined'` also lets `.default()` fire. Only a genuinely empty cell is translated — `' '` stays a space, unless `trim` is on.

## Missing columns

A file whose header is wrong fails on its first row, once per field, which reads like a data problem when it is a file problem. `checkHeaders` looks at the header before the first row is validated:

```ts
try {
    await pipeline(createReadStream('employees.csv'), createCsvValidator(Employee), sink);
} catch (error) {
    if (error instanceof MissingColumnsError)
        console.error(
            `missing: ${error.missing.join(', ')} — file has ${error.columns.join(', ')}`
        );
}
```

Required means the schema cannot do without it: a field that accepts `undefined` — `.optional()`, `.nullish()`, `.default()` — is not a required column. The check needs an object schema to read; anything else (a `z.record`, a schema behind `.refine()`) is left alone. Pass an explicit list to check those, or `false` to turn it off.

`MissingColumnsError` stops the stream whatever `onInvalidRow` says — it is a file-level problem, not a row-level one.

## Structural errors

A record `csv-parse` cannot read — the wrong number of fields, an unterminated quote — is a parse error, not a validation error, and by default it destroys the stream. `skipRecordsWithError` sends it down the same channel as an invalid row instead:

```ts
const rows = createCsvValidator(Employee, {
    skipRecordsWithError: true,
    onInvalidRow: 'collect',
});

await pipeline(createReadStream('employees.csv'), rows, sink);

for (const error of rows.errors) console.log(error.line, error.name);
```

Malformed records then arrive as `RowParseError` through `errors`, `onRowError` and `'invalid-row'`, count against `maxErrors` alongside the invalid rows, and keep their place in the file: the line numbers of the rows behind them stay right. Under `onInvalidRow: 'error'` they still stop the stream, just with a positioned `RowParseError` instead of the parser's own error.

`relaxColumnCount` is the other half of the story: it lets ragged rows reach the schema instead of failing at all.

## Batches

Most bulk inserts want arrays, not rows:

```ts
import { batched, createCsvValidator } from 'csv-zod-stream';

await pipeline(
    createReadStream('employees.csv'),
    createCsvValidator(Employee),
    batched<Employee>(500),
    async function (groups) {
        for await (const employees of groups) await db.insertMany(employees);
    }
);
```

The last batch is whatever is left over. Backpressure carries through it unchanged. `csv-zod-stream/web` exports a `TransformStream` of the same name.

## One-shot parsing

When the whole file fits in memory and you want both halves at once:

```ts
import { parseCsv, parseCsvFile } from 'csv-zod-stream';

const { rows, errors } = await parseCsvFile('employees.csv', Employee);
const fromText = await parseCsv('id,name\n1,Ada\n', Employee);
```

Both collect invalid rows rather than throwing on the first one — pass `onInvalidRow` to change that — and take the same options as the stream. `csv-zod-stream/web` exports `parseCsv` for a string or `Uint8Array`.

## Delimiters

`delimiter` takes any separator string, or `'auto'`:

```ts
createCsvValidator(Employee, { delimiter: '\t' });
createCsvValidator(Employee, { delimiter: 'auto' });
```

`'auto'` buffers up to five lines that are neither blank nor comments, skipping anything inside quotes, and then looks for the candidate — `,`, `;`, `\t` or `|` — that occurs the same number of times on every one of them. That is what a real delimiter does; a stray separator inside a header field does not, so `Name, full;age` over `a;1` still reads as `;`. If nothing is consistent it falls back to sheer frequency, and then to `,`. It honours `quote` and `escape`. It is still a heuristic — name the delimiter when you know it.

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

| Option                 | Default    | Meaning                                                                   |
| ---------------------- | ---------- | ------------------------------------------------------------------------- |
| `delimiter`            | `','`      | Field separator, or `'auto'` to sniff it                                  |
| `headers`              | `true`     | `true` reads names from the first row; an array names a headerless file   |
| `checkHeaders`         | `true`     | Fail fast on missing columns; `false` to skip, or an explicit column list |
| `emptyAs`              | `'keep'`   | Turn blank cells into `undefined` or `null` before validating             |
| `onInvalidRow`         | `'error'`  | `'error'` \| `'skip'` \| `'collect'`                                      |
| `maxErrors`            | `Infinity` | Invalid rows tolerated under `'skip'` / `'collect'`                       |
| `onRowError`           | —          | Called for each invalid row under `'skip'` / `'collect'`                  |
| `skipRecordsWithError` | `false`    | Route malformed records through the invalid-row channel                   |
| `bom`                  | `true`     | Strip a leading UTF-8 BOM                                                 |
| `skipEmptyLines`       | `true`     | Ignore blank lines rather than treating them as records                   |
| `relaxColumnCount`     | `false`    | Let ragged rows through so the schema judges them                         |
| `trim`                 | `false`    | Trim whitespace around unquoted fields                                    |
| `quote`                | `'"'`      | Quote character                                                           |
| `escape`               | `'"'`      | Escape character inside quoted fields                                     |
| `comment`              | —          | Ignore lines starting with this character                                 |
| `parse`                | —          | Raw [`csv-parse` options](https://csv.js.org/parse/options/)              |

### `parse` — the escape hatch

Anything `csv-parse` supports and this package does not name is reachable through `parse`:

```ts
createCsvValidator(Employee, {
    parse: { from_line: 3, to_line: 1000, max_record_size: 1_000_000, record_delimiter: '\u2028' },
});
```

The options above win over their `parse` equivalents when you set them, and fill in from `parse` when you do not. Four are the library's own and cannot be taken over: `delimiter`, `columns`, `info` and `raw` — the line numbers are built out of the last two.

## Not yet

Async validation (`safeParseAsync`), CSV generation from objects, and a browser `File` helper are all out of scope for now.

## License

MIT © Pavel Lazarchuk
