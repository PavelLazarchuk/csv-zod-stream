import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { batched, createCsvValidator, parseCsv } from '../src/index';
import type { CsvRow } from '../src/index';
import { parseCsv as webParseCsv } from '../src/web/index';
import { sliced } from './helpers';

const Row = z.object({ name: z.string(), note: z.string() });

describe('withMeta', () => {
    it('wraps each row with its physical line and record index', async () => {
        const { rows } = await parseCsv('name,note\na,x\nb,y\n', Row, { withMeta: true });

        expect(rows).toEqual([
            { row: { name: 'a', note: 'x' }, line: 2, record: 1 },
            { row: { name: 'b', note: 'y' }, line: 3, record: 2 },
        ]);
    });

    it('counts the lines a multiline record spans', async () => {
        const { rows } = await parseCsv('name,note\na,"one\ntwo"\nb,y\n', Row, { withMeta: true });

        expect(rows.map(entry => entry.line)).toEqual([2, 4]);
    });

    it('agrees with the line an invalid row reports', async () => {
        const Strict = z.object({ name: z.string(), note: z.coerce.number() });
        const { rows, errors } = await parseCsv('name,note\na,1\nb,zz\nc,3\n', Strict, {
            withMeta: true,
            onInvalidRow: 'collect',
        });

        expect(rows.map(entry => entry.line)).toEqual([2, 4]);
        expect(errors.map(error => error.line)).toEqual([3]);
    });

    it('streams the wrapped rows through batched()', async () => {
        const batches: CsvRow<z.output<typeof Row>>[][] = [];

        await pipeline(
            sliced('name,note\na,x\nb,y\nc,z\n', 4),
            createCsvValidator(Row, { withMeta: true }),
            batched<CsvRow<z.output<typeof Row>>>(2),
            async groups => {
                for await (const group of groups) batches.push(group);
            }
        );

        expect(batches.map(group => group.length)).toEqual([2, 1]);
        expect(batches[0]?.[0]).toEqual({ row: { name: 'a', note: 'x' }, line: 2, record: 1 });
    });

    it('lets a schema that outputs null stream', async () => {
        const Nulled = z.object({ name: z.string() }).transform(() => null);
        const { rows } = await parseCsv('name\na\nb\n', Nulled, { withMeta: true });

        expect(rows).toEqual([
            { row: null, line: 2, record: 1 },
            { row: null, line: 3, record: 2 },
        ]);
    });

    it('carries the meta through async validation', async () => {
        const Async = z.object({ name: z.string() }).transform(name => Promise.resolve(name));
        const { rows } = await parseCsv('name\na\n', Async, { withMeta: true, async: true });

        expect(rows).toEqual([{ row: { name: 'a' }, line: 2, record: 1 }]);
    });

    it('wraps rows on the web build', async () => {
        const { rows } = await webParseCsv('name,note\na,x\n', Row, { withMeta: true });

        expect(rows).toEqual([{ row: { name: 'a', note: 'x' }, line: 2, record: 1 }]);
    });
});
