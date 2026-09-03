---
'csv-zod-stream': patch
---

Fix three edge cases and document `comment` accurately.

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
