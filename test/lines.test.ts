import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createCsvValidator } from '../src/index';
import type { CsvValidatorOptions } from '../src/index';
import { createCsvValidator as createWebCsvValidator } from '../src/web/index';
import { sliced } from './helpers';

const Row = z.object({ name: z.string(), age: z.coerce.number() });

async function positions(text: string, options: CsvValidatorOptions = {}, chunkSize = 7) {
    const stream = createCsvValidator(Row, { onInvalidRow: 'collect', ...options });

    await pipeline(sliced(text, chunkSize), stream, async (source: AsyncIterable<unknown>) => {
        for await (const _row of source);
    });

    return stream.errors.map(error => ({ line: error.line, record: error.record, raw: error.raw }));
}

describe('physical line numbers', () => {
    it('skips over blank and comment lines ahead of the record', async () => {
        const text = '# generated\nname,age\n\n# section\na,x\n\nb,y\n';

        expect(await positions(text, { comment: '#' })).toEqual([
            { line: 5, record: 1, raw: 'a,x' },
            { line: 7, record: 2, raw: 'b,y' },
        ]);
    });

    it('does not count a CRLF inside a quoted field twice', async () => {
        const Noted = z.object({ name: z.string(), note: z.string(), age: z.coerce.number() });
        const stream = createCsvValidator(Noted, { onInvalidRow: 'collect' });
        const text =
            'name,note,age\r\na,"one\r\ntwo",x\r\nb,plain,y\r\nc,"three\r\nfour\r\nfive",z\r\n';

        await pipeline(sliced(text, 7), stream, async (source: AsyncIterable<unknown>) => {
            for await (const _row of source);
        });

        expect(stream.errors.map(error => [error.line, error.raw])).toEqual([
            [2, 'a,"one\r\ntwo",x'],
            [4, 'b,plain,y'],
            [5, 'c,"three\r\nfour\r\nfive",z'],
        ]);
    });

    it('handles CR-only line endings', async () => {
        expect(await positions('name,age\ra,1\rb,x\r')).toEqual([
            { line: 3, record: 2, raw: 'b,x' },
        ]);
    });

    it('handles the last record without a trailing newline', async () => {
        expect(await positions('name,age\na,1\nb,x')).toEqual([{ line: 3, record: 2, raw: 'b,x' }]);
    });

    it('counts blank lines as records when skipEmptyLines is off', async () => {
        const Loose = z.object({ name: z.string().min(1) });
        const stream = createCsvValidator(Loose, {
            onInvalidRow: 'collect',
            skipEmptyLines: false,
            relaxColumnCount: true,
        });

        await pipeline(
            sliced('name\na\n\nb\n', 3),
            stream,
            async (source: AsyncIterable<unknown>) => {
                for await (const _row of source);
            }
        );

        expect(stream.errors.map(error => [error.line, error.record, error.raw])).toEqual([
            [3, 2, ''],
        ]);
    });

    it('starts at line 1 when the columns come from options', async () => {
        const text = '\na,x\nb,2\n';

        expect(await positions(text, { headers: ['name', 'age'] })).toEqual([
            { line: 2, record: 1, raw: 'a,x' },
        ]);
    });

    it('ignores a whitespace-only line skipped under trim', async () => {
        expect(await positions('name,age\n   \na,x\n', { trim: true })).toEqual([
            { line: 3, record: 1, raw: 'a,x' },
        ]);
    });

    it('agrees between the Node and the web build', async () => {
        const text = 'name,age\n\n# c\na,"multi\nline"\nb,x\n';
        const Noted = z.object({ name: z.string(), age: z.coerce.number() });
        const validator = createWebCsvValidator(Noted, { onInvalidRow: 'collect', comment: '#' });
        const bytes = new TextEncoder().encode(text);
        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(bytes);
                controller.close();
            },
        });

        for await (const _row of source.pipeThrough(validator));

        expect(validator.errors.map(error => [error.line, error.raw])).toEqual([
            [4, 'a,"multi\nline"'],
            [6, 'b,x'],
        ]);
    });
});
