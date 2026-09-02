// Fast producer, slow consumer, heap sampled as it goes.
// Run with: node --expose-gc scripts/bench-memory.mjs
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setImmediate as tick } from 'node:timers/promises';
import { z } from 'zod';

import { createCsvValidator } from '../dist/index.js';

const ROWS = Number(process.argv[2] ?? 200_000);
const CHUNK = 64 * 1024;

const Row = z.object({ name: z.string(), age: z.coerce.number().int() });

function source(produced) {
    return Readable.from(
        (function* () {
            let buffer = 'name,age\n';

            while (produced.rows < ROWS) {
                while (buffer.length < CHUNK && produced.rows < ROWS) {
                    buffer += `person-${produced.rows++},${(produced.rows % 90) + 1}\n`;
                }

                produced.bytes += buffer.length;
                yield Buffer.from(buffer);
                buffer = '';
            }
        })()
    );
}

const produced = { rows: 0, bytes: 0 };
const samples = [];
let consumed = 0;

const started = Date.now();

await pipeline(source(produced), createCsvValidator(Row), async rows => {
    for await (const _row of rows) {
        if (++consumed % 1_000 === 0) await tick();

        if (consumed % Math.floor(ROWS / 10) === 0) {
            globalThis.gc?.();
            samples.push([consumed, process.memoryUsage().heapUsed]);
        }
    }
});

const width = 40;
const peak = Math.max(...samples.map(([, heap]) => heap));

console.log(
    `${consumed} rows, ${(produced.bytes / 1e6).toFixed(1)} MB, ${Date.now() - started} ms`
);
if (!globalThis.gc) console.log('(run with --expose-gc for retained-heap numbers)');

for (const [rows, heap] of samples) {
    const bar = '█'.repeat(Math.max(1, Math.round((heap / peak) * width)));
    console.log(`${String(rows).padStart(9)}  ${(heap / 1e6).toFixed(1).padStart(6)} MB  ${bar}`);
}
