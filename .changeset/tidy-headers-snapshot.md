---
'csv-zod-stream': patch
---

Fix header aliasing, error snapshots and header option validation

- `columnAliases` no longer resolves a header named after an `Object.prototype` member, such as `constructor` or `toString`, to the inherited function, which made the parser reject the header row.
- `errors` and `TooManyInvalidRowsError.errors` now return a snapshot instead of the live buffer, so an array read mid-stream no longer changes under the caller as more rows are rejected.
- `headers` that is neither `true` nor an array, and `checkHeaders` that is neither a boolean nor an array of names, now throw a `RangeError` from `createCsvValidator` instead of failing later with a `TypeError`.
