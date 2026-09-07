import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { RowValidationError, TooManyInvalidRowsError, createCsvValidator } from '../src/web/index';
import type { CsvValidatorOptions } from '../src/web/index';

const Row = z.object({ name: z.string(), note: z.string() });

function feed<S extends z.ZodType>(
    schema: S,
    text: string,
    options?: CsvValidatorOptions,
    size = 5
) {
    const bytes = new TextEncoder().encode(text);
    const validator = createCsvValidator(schema, options);

    const source = new ReadableStream<Uint8Array>({
        start(controller) {
            for (let i = 0; i < bytes.length; i += size)
                controller.enqueue(bytes.slice(i, i + size));
            controller.close();
        },
    });

    return { validator, rows: source.pipeThrough(validator) };
}

async function drain<T>(stream: ReadableStream<T>): Promise<T[]> {
    const rows: T[] = [];

    for await (const row of stream) rows.push(row);

    return rows;
}

describe('web streams', () => {
    it('validates rows split across chunk boundaries', async () => {
        const { rows } = feed(Row, 'name,note\na,"line one\nline two"\nb,plain\n');

        expect(await drain(rows)).toEqual([
            { name: 'a', note: 'line one\nline two' },
            { name: 'b', note: 'plain' },
        ]);
    });

    it('strips a BOM and reads CRLF', async () => {
        const { rows } = feed(Row, '﻿name,note\r\na,"x\r\ny"\r\n');

        expect(await drain(rows)).toEqual([{ name: 'a', note: 'x\r\ny' }]);
    });

    it('errors the readable side on an invalid row', async () => {
        const Ages = z.object({ name: z.string(), age: z.coerce.number() });
        const { rows } = feed(Ages, 'name,age\na,1\nb,nope\n');

        await expect(drain(rows)).rejects.toBeInstanceOf(RowValidationError);
    });

    it('propagates a parse error', async () => {
        const { rows } = feed(Row, 'name,note\na,b,c\n');

        await expect(drain(rows)).rejects.toThrow(/columns length/i);
    });

    it('skips and collects the same way as the Node build', async () => {
        const Ages = z.object({ name: z.string(), age: z.coerce.number() });
        const onRowError = vi.fn();
        const { validator, rows } = feed(Ages, 'name,age\na,1\nb,nope\nc,3\n', {
            onInvalidRow: 'collect',
            onRowError,
        });

        expect(await drain(rows)).toEqual([
            { name: 'a', age: 1 },
            { name: 'c', age: 3 },
        ]);
        expect(validator.errors.map(error => error.line)).toEqual([3]);
        expect(onRowError).toHaveBeenCalledOnce();
    });

    it('stops once maxErrors is exceeded', async () => {
        const Ages = z.object({ name: z.string(), age: z.coerce.number() });
        const { rows } = feed(Ages, 'name,age\na,x\nb,y\nc,z\n', {
            onInvalidRow: 'skip',
            maxErrors: 1,
        });

        await expect(drain(rows)).rejects.toBeInstanceOf(TooManyInvalidRowsError);
    });

    it('sniffs the delimiter', async () => {
        const { rows } = feed(Row, 'name;note\na;"x\ny"\n', { delimiter: 'auto' }, 1);

        expect(await drain(rows)).toEqual([{ name: 'a', note: 'x\ny' }]);
    });

    it('sniffs a file with a single line and no break', async () => {
        const { rows } = feed(Row, 'name\tnote', { delimiter: 'auto' });

        expect(await drain(rows)).toEqual([]);
    });

    it('sniffs past a comment line', async () => {
        const { rows } = feed(Row, '# a, b\nname;note\na;b\n', { delimiter: 'auto', comment: '#' });

        expect(await drain(rows)).toEqual([{ name: 'a', note: 'b' }]);
    });

    it('fails the readable side when onRowError throws', async () => {
        const Ages = z.object({ name: z.string(), age: z.coerce.number() });
        const { rows } = feed(Ages, 'name,age\na,1\nb,nope\n', {
            onInvalidRow: 'skip',
            onRowError: () => {
                throw new Error('callback blew up');
            },
        });

        await expect(drain(rows)).rejects.toThrow('callback blew up');
    });

    it('surfaces an aborted source', async () => {
        const validator = createCsvValidator(Row);
        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.error(new Error('network died'));
            },
        });

        await expect(drain(source.pipeThrough(validator))).rejects.toThrow('network died');
    });

    it('errors the writable side too, so a manual producer does not hang', async () => {
        const validator = createCsvValidator(Row);
        const writer = validator.writable.getWriter();

        void validator.readable
            .getReader()
            .read()
            .catch(() => {});

        const wrote = (async () => {
            for (let i = 0; i < 100; i++)
                await writer.write(new TextEncoder().encode('name,note\na,b,c\n'));
        })();

        await expect(Promise.race([wrote, writer.closed])).rejects.toThrow(/columns length/i);
    });

    it('only pulls what the consumer asks for', async () => {
        let pulls = 0;
        const bytes = new TextEncoder().encode(
            `name,note\n${Array.from({ length: 200_000 }, (_, i) => `n${i},x`).join('\n')}\n`
        );
        const chunks = Math.ceil(bytes.length / 4096);

        const source = new ReadableStream<Uint8Array>({
            pull(controller) {
                const start = pulls++ * 4096;

                if (start >= bytes.length) return controller.close();
                controller.enqueue(bytes.slice(start, start + 4096));
            },
        });

        const reader = source.pipeThrough(createCsvValidator(Row)).getReader();

        for (let i = 0; i < 10; i++) await reader.read();

        expect(chunks).toBeGreaterThan(300);
        expect(pulls).toBeLessThan(20);

        await reader.cancel();
    });
});
