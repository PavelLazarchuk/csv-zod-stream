import { pipeline } from 'node:stream/promises';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { RowValidationError, createCsvValidator, parseCsv } from '../src/index';
import { parseCsv as webParseCsv } from '../src/web/index';
import { collect, sliced } from './helpers';

const known = new Set(['ada@example.com', 'grace@example.com']);

const Employee = z.object({
    id: z.coerce.number(),
    email: z.string().refine(email => Promise.resolve(known.has(email)), 'unknown address'),
});

const file = 'id,email\n1,ada@example.com\n2,nobody@example.com\n3,grace@example.com\n';

describe('async validation', () => {
    it('runs an async refinement and keeps the rows that pass', async () => {
        const { rows, errors } = await parseCsv(file, Employee, { async: true });

        expect(rows).toEqual([
            { id: 1, email: 'ada@example.com' },
            { id: 3, email: 'grace@example.com' },
        ]);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(RowValidationError);
        expect(errors[0]?.line).toBe(3);
    });

    it('fails the stream on the first invalid row by default', async () => {
        const failure = await collect(Employee, file, { async: true }).catch(
            (error: Error) => error
        );

        expect(failure).toBeInstanceOf(RowValidationError);
        expect((failure as RowValidationError).line).toBe(3);
    });

    it('leaves the async schema to blow up when the option is off', async () => {
        const failure = await collect(Employee, file).catch((error: Error) => error);

        expect(failure).toBeInstanceOf(Error);
        expect(failure).not.toBeInstanceOf(RowValidationError);
    });

    it('keeps row order while awaiting', async () => {
        const Slow = z.object({ id: z.coerce.number() }).transform(async row => {
            await new Promise(resolve => setTimeout(resolve, row.id % 2 ? 4 : 0));

            return row;
        });

        const rows = await collect(Slow, `id\n${[1, 2, 3, 4, 5].join('\n')}\n`, { async: true });

        expect(rows).toEqual([1, 2, 3, 4, 5].map(id => ({ id })));
    });

    it('fails the stream when the schema rejects rather than returning an issue', async () => {
        const Throwing = z.object({ id: z.coerce.number() }).transform(async () => {
            await Promise.resolve();

            throw new Error('lookup down');
        });

        const failure = await collect(Throwing, 'id\n1\n', { async: true }).catch(
            (error: Error) => error
        );

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toBe('lookup down');
    });

    it('still stops the reader for a slow consumer', async () => {
        const rows = 4_000;
        const text = `id,email\n${Array.from({ length: rows }, () => '1,ada@example.com').join('\n')}\n`;
        const source = sliced(text, 64);
        let read = 0;
        let seen = 0;

        source.on('data', () => read++);

        await pipeline(source, createCsvValidator(Employee, { async: true }), async validated => {
            for await (const _row of validated) {
                seen++;
                if (seen % 100 === 0) await new Promise(resolve => setImmediate(resolve));
            }
        });

        expect(seen).toBe(rows);
        expect(read).toBeGreaterThan(0);
    });

    it('reports every invalid row through onRowError', async () => {
        const onRowError = vi.fn();

        await parseCsv(file, Employee, { async: true, onInvalidRow: 'skip', onRowError });

        expect(onRowError).toHaveBeenCalledTimes(1);
    });

    it('fails the stream when onRowError throws on an awaited row', async () => {
        const failure = await collect(Employee, file, {
            async: true,
            onInvalidRow: 'skip',
            onRowError: () => {
                throw new Error('logger down');
            },
        }).catch((error: Error) => error);

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toBe('logger down');
    });

    it('works on the web build', async () => {
        const { rows, errors } = await webParseCsv(file, Employee, { async: true });

        expect(rows).toEqual([
            { id: 1, email: 'ada@example.com' },
            { id: 3, email: 'grace@example.com' },
        ]);
        expect(errors).toHaveLength(1);
    });
});
