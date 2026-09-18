import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createCsvValidator, parseCsv, parseCsvFile } from '../src/index';
import type { CsvStats } from '../src/index';
import { parseCsv as webParseCsv, createCsvValidator as webValidator } from '../src/web/index';
import { sliced } from './helpers';

const Person = z.object({ name: z.string(), age: z.coerce.number() });

function csv(rows: number): string {
    let text = 'name,age\n';

    for (let i = 0; i < rows; i++) text += `p${i},${i}\n`;

    return text;
}

async function drain(text: string, options = {}, chunkSize = 64) {
    const stream = createCsvValidator(Person, options);

    await pipeline(sliced(text, chunkSize), stream, async source => {
        for await (const _row of source);
    });

    return stream;
}

describe('stats', () => {
    it('counts records, valid rows and bytes as the stream runs', async () => {
        const text = csv(10);
        const stream = await drain(text);

        expect(stream.stats).toMatchObject({ records: 10, valid: 10, invalid: 0, dropped: 0 });
        expect(stream.stats.bytes).toBeGreaterThan(0);
        expect(stream.stats.bytes).toBeLessThanOrEqual(Buffer.byteLength(text));
    });

    it('separates the rows the schema refused from the rows it took', async () => {
        const stream = await drain('name,age\nAda,36\nGrace,nope\nAlan,41\n', {
            onInvalidRow: 'collect',
        });

        expect(stream.stats).toMatchObject({ records: 3, valid: 2, invalid: 1 });
    });

    it('counts malformed records as invalid alongside the schema failures', async () => {
        const stream = await drain('name,age\nAda,36,extra\nAlan,41\n', {
            skipRecordsWithError: true,
            onInvalidRow: 'collect',
        });

        expect(stream.stats).toMatchObject({ valid: 1, invalid: 1 });
    });

    it('reports the errors the ring buffer had to drop', async () => {
        const stream = await drain('name,age\nAda,x\nGrace,y\nAlan,z\n', {
            onInvalidRow: 'collect',
            keepErrors: 1,
        });

        expect(stream.stats).toMatchObject({ invalid: 3, dropped: 2 });
        expect(stream.stats.dropped).toBe(stream.droppedErrors);
    });

    it('comes back from `parseCsv` and `parseCsvFile`', async () => {
        const { stats } = await parseCsv(csv(3), Person);

        expect(stats).toMatchObject({ records: 3, valid: 3 });

        const directory = await mkdtemp(join(tmpdir(), 'csv-zod-stream-'));
        const path = join(directory, 'people.csv');

        await writeFile(path, csv(7), 'utf8');

        try {
            const file = await parseCsvFile(path, Person);

            expect(file.stats).toMatchObject({ records: 7, valid: 7 });
            expect(file.stats.bytes).toBeGreaterThan(0);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it('is a snapshot, not a live view', async () => {
        const stream = await drain(csv(4));
        const first = stream.stats;

        expect(stream.stats).not.toBe(first);
        expect(stream.stats).toEqual(first);
    });
});

describe('onProgress', () => {
    it('reports every `progressEveryRecords` records, and once at the end', async () => {
        const seen: CsvStats[] = [];

        await drain(csv(25), {
            progressEveryRecords: 10,
            onProgress: (stats: CsvStats) => void seen.push(stats),
        });

        expect(seen.map(stats => stats.records)).toEqual([10, 20, 25]);
        expect(seen.at(-1)).toMatchObject({ valid: 25, invalid: 0 });
    });

    it('defaults to a thousand records, so a small file reports once', async () => {
        const onProgress = vi.fn();

        await drain(csv(50), { onProgress });

        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(onProgress.mock.calls[0]?.[0]).toMatchObject({ records: 50, valid: 50 });
    });

    it('says nothing at all about an empty file', async () => {
        const onProgress = vi.fn();

        await drain('name,age\n', { onProgress });

        expect(onProgress).not.toHaveBeenCalled();
    });

    it('also fires on a byte threshold', async () => {
        const seen: CsvStats[] = [];

        await drain(csv(200), {
            progressEveryBytes: 200,
            onProgress: (stats: CsvStats) => void seen.push(stats),
        });

        expect(seen.length).toBeGreaterThan(2);
        expect(seen.at(-1)?.records).toBe(200);
    });

    it('works on the async path as well', async () => {
        const seen: CsvStats[] = [];

        await drain(csv(6), {
            async: true,
            progressEveryRecords: 2,
            onProgress: (stats: CsvStats) => void seen.push(stats),
        });

        expect(seen.map(stats => stats.records)).toEqual([2, 4, 6]);
    });

    it('fails the stream instead of crashing when the callback throws', async () => {
        await expect(
            drain(csv(3), {
                onProgress: () => {
                    throw new Error('progress blew up');
                },
            })
        ).rejects.toThrow('progress blew up');
    });

    it('fails the web stream the same way', async () => {
        const validator = webValidator(Person, {
            onProgress: () => {
                throw new Error('progress blew up');
            },
        });

        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(csv(3)));
                controller.close();
            },
        });

        await expect(
            (async () => {
                for await (const _row of source.pipeThrough(validator));
            })()
        ).rejects.toThrow('progress blew up');
    });

    it('reaches the web build through the same sink', async () => {
        const seen: CsvStats[] = [];
        const validator = webValidator(Person, {
            progressEveryRecords: 5,
            onProgress: (stats: CsvStats) => void seen.push(stats),
        });

        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(csv(12)));
                controller.close();
            },
        });

        for await (const _row of source.pipeThrough(validator));

        expect(seen.map(stats => stats.records)).toEqual([5, 10, 12]);
        expect(validator.stats).toMatchObject({ records: 12, valid: 12 });

        const { stats } = await webParseCsv(csv(2), Person);

        expect(stats).toMatchObject({ records: 2, valid: 2 });
    });
});
