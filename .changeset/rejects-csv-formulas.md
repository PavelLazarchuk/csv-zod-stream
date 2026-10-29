---
'csv-zod-stream': minor
---

`rejectsCsv` defuses spreadsheet formulas

The rejects file carries each rejected row's `raw` text, which comes straight from the uploaded file, and is meant to be opened in Excel. A row such as `=HYPERLINK(...)` or `@SUM(...)` ran as a formula there (CSV injection). A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return now gets a leading `'`, so spreadsheets show it as text.

Pass `escapeFormulas: false` to get the previous, unprefixed output when the file is only read by code.
