import { Readable } from 'node:stream';
import { setImmediate as tick } from 'node:timers/promises';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createCsvValidator } from '../src/index';

const Row = z.object({ name: z.string(), age: z.coerce.number() });

const CHUNK = 64 * 1024;

function producer(state: { chunks: number }) {
    return Readable.from(
        (function* () {
            let row = 0;
            let buffer = 'name,age\n';

            for (;;) {
                while (buffer.length < CHUNK) buffer += `person-${row++},${row % 90}\n`;

                state.chunks++;
                yield Buffer.from(buffer.slice(0, CHUNK));
                buffer = buffer.slice(CHUNK);
            }
        })()
    );
}

describe('backpressure', () => {
    it('holds the producer back when the consumer is slow', async () => {
        const state = { chunks: 0 };
        const source = producer(state);
        const stream = createCsvValidator(Row);
        let consumed = 0;

        await pipeline(source, stream, async (rows: AsyncIterable<unknown>) => {
            for await (const _row of rows) {
                await tick();
                if (++consumed === 300) break;
            }
        }).catch(() => {
            /* breaking out of the consumer destroys the pipeline */
        });

        // 300 rows is ~5 kB of CSV. Without backpressure the producer would have
        // run to the end of the file; here it stays within a couple of chunks.
        expect(consumed).toBe(300);
        expect(state.chunks).toBeLessThanOrEqual(4);
    });

    it('keeps the in-flight window bounded across a million rows', async () => {
        const rows = 1_000_000;
        let produced = 0;
        let consumed = 0;
        let widest = 0;

        const source = Readable.from(
            (function* () {
                let buffer = 'name,age\n';

                while (produced < rows) {
                    while (buffer.length < CHUNK && produced < rows) {
                        buffer += `person-${produced++},${(produced % 90) + 1}\n`;
                    }

                    yield Buffer.from(buffer);
                    buffer = '';
                }
            })()
        );

        await pipeline(source, createCsvValidator(Row), async (parsed: AsyncIterable<unknown>) => {
            for await (const _row of parsed) {
                consumed++;
                widest = Math.max(widest, produced - consumed);
            }
        });

        expect(consumed).toBe(rows);
        expect(widest).toBeLessThan(30_000);
    }, 60_000);
});
