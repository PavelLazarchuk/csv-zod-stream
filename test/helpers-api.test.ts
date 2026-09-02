import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
    RowValidationError,
    batched,
    createCsvValidator,
    parseCsv,
    parseCsvFile,
} from '../src/index';
import { batched as webBatched, parseCsv as webParseCsv } from '../src/web/index';
import { sliced } from './helpers';

const Row = z.object({ name: z.string(), age: z.coerce.number() });

const GOOD = 'name,age\na,1\nb,2\nc,3\n';
const MIXED = 'name,age\na,1\nb,nope\nc,3\n';

describe('parseCsv', () => {
    it('returns the rows and the errors side by side', async () => {
        const { rows, errors } = await parseCsv(MIXED, Row);

        expect(rows).toEqual([
            { name: 'a', age: 1 },
            { name: 'c', age: 3 },
        ]);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(RowValidationError);
        expect(errors[0]!.line).toBe(3);
    });

    it('takes bytes as well as a string', async () => {
        const { rows } = await parseCsv(new TextEncoder().encode(GOOD), Row);

        expect(rows).toHaveLength(3);
    });

    it('handles an empty input', async () => {
        expect(await parseCsv('', Row)).toEqual({ rows: [], errors: [] });
    });

    it('still honours an explicit strategy', async () => {
        await expect(parseCsv(MIXED, Row, { onInvalidRow: 'error' })).rejects.toBeInstanceOf(
            RowValidationError
        );
    });

    it('sniffs and passes options through like the stream does', async () => {
        const { rows } = await parseCsv('name;age\na;1\n', Row, { delimiter: 'auto' });

        expect(rows).toEqual([{ name: 'a', age: 1 }]);
    });

    it('matches the web build', async () => {
        const node = await parseCsv(MIXED, Row);
        const web = await webParseCsv(MIXED, Row);

        expect(web.rows).toEqual(node.rows);
        expect(web.errors.map(e => [e.name, e.line])).toEqual(
            node.errors.map(e => [e.name, e.line])
        );
    });
});

describe('parseCsvFile', () => {
    let directory: string;

    beforeAll(async () => {
        directory = await mkdtemp(join(tmpdir(), 'csv-zod-stream-'));
        await writeFile(join(directory, 'people.csv'), MIXED, 'utf8');
    });

    afterAll(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    it('reads the file off disk', async () => {
        const { rows, errors } = await parseCsvFile(join(directory, 'people.csv'), Row);

        expect(rows).toHaveLength(2);
        expect(errors).toHaveLength(1);
    });

    it('rejects when the file is not there', async () => {
        await expect(parseCsvFile(join(directory, 'nope.csv'), Row)).rejects.toThrow(/ENOENT/);
    });
});

describe('batched', () => {
    async function group(text: string, size: number) {
        const batches: unknown[][] = [];

        await pipeline(
            sliced(text, 5),
            createCsvValidator(Row),
            batched<z.infer<typeof Row>>(size),
            async (source: AsyncIterable<unknown[]>) => {
                for await (const batch of source) batches.push(batch);
            }
        );

        return batches;
    }

    it('emits full batches and then the remainder', async () => {
        expect(await group(GOOD, 2)).toEqual([
            [
                { name: 'a', age: 1 },
                { name: 'b', age: 2 },
            ],
            [{ name: 'c', age: 3 }],
        ]);
    });

    it('emits nothing for an empty stream', async () => {
        expect(await group('name,age\n', 2)).toEqual([]);
    });

    it('emits one batch when the size covers everything', async () => {
        expect(await group(GOOD, 10)).toHaveLength(1);
    });

    it('rejects a size that is not a positive integer', () => {
        expect(() => batched(0)).toThrow(RangeError);
        expect(() => batched(1.5)).toThrow(RangeError);
        expect(() => webBatched(-1)).toThrow(RangeError);
    });

    it('groups the same way on the web build', async () => {
        const bytes = new TextEncoder().encode(GOOD);
        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(bytes);
                controller.close();
            },
        });
        const batches: unknown[][] = [];

        const { createCsvValidator: createWebCsvValidator } = await import('../src/web/index');

        for await (const batch of source
            .pipeThrough(createWebCsvValidator(Row))
            .pipeThrough(webBatched<z.infer<typeof Row>>(2)))
            batches.push(batch);

        expect(batches).toEqual(await group(GOOD, 2));
    });

    it('keeps the pressure on when the consumer is slow', async () => {
        let produced = 0;
        const source = Readable.from(
            (function* () {
                let buffer = 'name,age\n';

                while (produced < 200_000) {
                    while (buffer.length < 64 * 1024 && produced < 200_000)
                        buffer += `p${produced++},1\n`;

                    yield Buffer.from(buffer);
                    buffer = '';
                }
            })()
        );

        let consumed = 0;
        let widest = 0;

        await pipeline(
            source,
            createCsvValidator(Row),
            batched<z.infer<typeof Row>>(100),
            async (batches: AsyncIterable<unknown[]>) => {
                for await (const batch of batches) {
                    consumed += batch.length;
                    widest = Math.max(widest, produced - consumed);
                }
            }
        );

        expect(consumed).toBe(200_000);
        expect(widest).toBeLessThan(30_000);
    }, 30_000);
});
