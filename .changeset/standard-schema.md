---
'csv-zod-stream': major
---

Any Standard Schema, not only Zod.

The package never did more with a schema than validate one row, which is exactly the [Standard Schema](https://standardschema.dev) contract. It now accepts anything that implements it — Zod 3.24+, Zod 4, `zod/mini`, Valibot, ArkType — with the same types, the same errors and no adapter. Zod is still first: it is taken through `safeParse`, so a real `ZodError` is still on the row error, and nothing about a Zod call site changes.

**Breaking:**

- `RowValidationError.zodError` is now `ZodError | undefined` — `undefined` when the schema was not Zod. The new `RowValidationError.issues` — `{ path, message }[]` — is filled in whatever the schema, and is what `rejectsCsv` now reads for its `field` column. Code that reaches straight for `error.zodError.issues` needs a check, or a move to `error.issues`.
- The schema type parameter is `StandardSchemaV1` rather than `ZodType`, and the row type comes from `StandardSchemaV1.InferOutput`. Inference for a Zod schema is unchanged; a function that was generic over `ZodType` may need its own bound widened.
- `zod` is now an _optional_ peer dependency, and no type in the published `.d.ts` imports from it: `zodError` is typed structurally as `ZodErrorLike`. A caller who wants `ZodError`'s own methods can cast.
- `createCsvValidator`, `parseCsv` and `parseCsvFile` throw a `TypeError` when handed something that is neither a Zod schema nor a Standard Schema, instead of failing on the first row.

**Also:**

- A schema that validates asynchronously is awaited whether or not `async` is set. The option still means "take Zod's `safeParseAsync` route".
- The header check reads `entries` as well as `shape`, so `zod/mini` and Valibot object schemas get missing-column and unknown-column checking too. A schema whose fields cannot be asked about synchronously is left alone, as before.

The root entry grows to 6.66 kB gzipped and the web entry to 6.2 kB.
