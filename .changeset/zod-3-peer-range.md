---
'csv-zod-stream': minor
---

Accept zod 3 as well as zod 4. The peer range widens to `^3.20.0 || ^4.0.0`, so a project already on zod 3 installs without an `ERESOLVE` conflict and keeps the version it has, while a fresh install still resolves to v4. Nothing in `src` used a v4-only API — the library only ever calls `safeParse` and reads `error.issues` — so this is a range change plus a CI job that runs the suite against zod 3.20.
