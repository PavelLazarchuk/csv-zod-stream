import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { RowValidationError, TooManyInvalidRowsError, createCsvValidator } from '../src/index';
import type { CsvRowError, CsvValidatorOptions } from '../src/index';
import { collect, sliced, validationErrors } from './helpers';

const Row = z.object({ name: z.string(), age: z.coerce.number().int().positive() });

const BAD = 'name,age\na,1\nb,nope\nc,3\n';

function run(text: string, options: CsvValidatorOptions, chunkSize = 7) {
    const stream = createCsvValidator(Row, options);
    const rows: z.infer<typeof Row>[] = [];
    const invalid: CsvRowError[] = [];

    stream.on('invalid-row', error => invalid.push(error));

    const done = pipeline(
        sliced(text, chunkSize),
        stream,
        async (source: AsyncIterable<z.infer<typeof Row>>) => {
            for await (const row of source) rows.push(row);
        }
    );

    return { stream, rows, invalid, done };
}

describe("onInvalidRow: 'error'", () => {
    it('destroys the stream on the first bad row', async () => {
        const { done, rows } = run(BAD, { onInvalidRow: 'error' });

        await expect(done).rejects.toBeInstanceOf(RowValidationError);
        expect(rows.length).toBeLessThan(2);
    });

    it('is the default', async () => {
        await expect(collect(Row, BAD)).rejects.toBeInstanceOf(RowValidationError);
    });
});

describe("onInvalidRow: 'skip'", () => {
    it('drops the row, reports it and keeps going', async () => {
        const { done, rows, invalid, stream } = run(BAD, { onInvalidRow: 'skip' });

        await done;

        expect(rows).toEqual([
            { name: 'a', age: 1 },
            { name: 'c', age: 3 },
        ]);
        expect(invalid).toHaveLength(1);
        expect(validationErrors(invalid)[0]!.record).toBe(2);
        expect(stream.errors).toEqual([]);
    });

    it('calls onRowError as well', async () => {
        const onRowError = vi.fn();

        await run(BAD, { onInvalidRow: 'skip', onRowError }).done;

        expect(onRowError).toHaveBeenCalledTimes(1);
        expect(onRowError.mock.calls[0]![0]).toBeInstanceOf(RowValidationError);
    });
});

describe("onInvalidRow: 'collect'", () => {
    it('keeps every invalid row on .errors', async () => {
        const { done, rows, stream } = run('name,age\nx,0\na,1\ny,no\n', {
            onInvalidRow: 'collect',
        });

        await done;

        expect(rows).toEqual([{ name: 'a', age: 1 }]);
        expect(validationErrors(stream.errors).map(error => error.record)).toEqual([1, 3]);
        expect(validationErrors(stream.errors)[0]!.zodError.issues[0]!.path).toEqual(['age']);
    });

    it('destroys the stream once maxErrors is exceeded', async () => {
        const { done, stream } = run('name,age\nw,no\nx,no\ny,no\nz,no\n', {
            onInvalidRow: 'collect',
            maxErrors: 2,
        });

        await expect(done).rejects.toBeInstanceOf(TooManyInvalidRowsError);
        expect(stream.errors).toHaveLength(3);
    });

    it('applies maxErrors under skip too', async () => {
        const { done } = run('name,age\nw,no\nx,no\n', { onInvalidRow: 'skip', maxErrors: 0 });

        await expect(done).rejects.toMatchObject({
            name: 'TooManyInvalidRowsError',
            count: 1,
            errors: [],
        });
    });
});

describe('RowValidationError', () => {
    it('points at the physical line, not the record index', async () => {
        const Noted = z.object({ name: z.string(), note: z.string(), age: z.coerce.number() });
        const stream = createCsvValidator(Noted, { onInvalidRow: 'error' });
        const text = 'name,note,age\na,"multi\nline\nvalue",1\nb,x,2\nc,y,bad\n';

        const done = pipeline(sliced(text, 7), stream, async (source: AsyncIterable<unknown>) => {
            for await (const _row of source);
        });

        // record 1 spans lines 2-4, record 2 is line 5, the bad record 3 is line 6.
        await expect(done).rejects.toMatchObject({ line: 6, record: 3 });
    });

    it('stays accurate deep into a large file', async () => {
        const rows = Array.from({ length: 200_000 }, (_, i) => `name${i},1`);
        rows[149_999] = 'boom,not-a-number';

        const text = `name,age\n${rows.join('\n')}\n`;
        const { done } = run(text, { onInvalidRow: 'error' }, 64 * 1024);

        await expect(done).rejects.toMatchObject({ line: 150_001, record: 150_000 });
    });

    it('carries the raw record and a readable message', async () => {
        const { done } = run(BAD, { onInvalidRow: 'error' });

        await expect(done).rejects.toMatchObject({
            raw: expect.stringContaining('b,nope'),
            message: expect.stringContaining('age:'),
        });
    });

    it('mentions the extra issues it is not showing', () => {
        const result = z.object({ a: z.string(), b: z.string() }).safeParse({});
        const error = new RowValidationError(2, 1, 'raw', result.error!);

        expect(error.message).toMatch(/\+1 more issue\b/);
    });

    it('does not choke on a symbol in the issue path', () => {
        const issue = { code: 'custom', path: [Symbol('tag'), 0], message: 'bad' };
        const error = new RowValidationError(2, 1, 'raw', { issues: [issue] } as any);

        expect(error.message).toContain('Symbol(tag).0: bad');
    });
});

describe('callbacks and schemas that throw', () => {
    it('fails the stream instead of crashing when onRowError throws late', async () => {
        const lines = ['name,age'];
        for (let i = 0; i < 40; i++) lines.push(i === 30 ? 'bad,x' : `p${i},1`);

        const stream = createCsvValidator(Row, {
            onInvalidRow: 'skip',
            onRowError: () => {
                throw new Error('callback blew up');
            },
        });

        const done = pipeline(
            sliced(`${lines.join('\n')}\n`, 64 * 1024),
            stream,
            async (source: AsyncIterable<unknown>) => {
                for await (const _row of source) await sleep(1);
            }
        );

        await expect(done).rejects.toThrow('callback blew up');
    });

    it('surfaces a schema that needs async parsing', async () => {
        const Async = Row.refine(async () => true);

        await expect(collect(Async, 'name,age\na,1\n')).rejects.toThrow(/async/i);
    });

    it('surfaces a transform that throws', async () => {
        const Throwing = Row.transform(() => {
            throw new Error('boom in transform');
        });

        await expect(collect(Throwing, 'name,age\na,1\n')).rejects.toThrow('boom in transform');
    });

    it('wraps a non-Error throw', async () => {
        const Throwing = Row.transform(() => {
            throw 'plain string';
        });

        await expect(collect(Throwing, 'name,age\na,1\n')).rejects.toMatchObject({
            message: 'plain string',
        });
    });
});
