---
'csv-zod-stream': patch
---

Fix delimiter sniffing on files with CR-only line endings. The scanner treated
only LF as a line end, so `delimiter: 'auto'` never found the end of the first
line: it sampled the whole buffer instead of the header, and skipped neither
comment nor blank lines ahead of it. A `#`-comment containing commas could win
the vote over the real delimiter. Affects both the Node and the web build.

Fix the reported line and `raw` of an invalid row when the parser dropped one of
its fields — extra columns under `relaxColumnCount`, or duplicate header names.
Line positions are now read off the record's own text rather than off its parsed
values, so a dropped field that spans several lines no longer shifts the
position or truncates `RowValidationError.raw`.
