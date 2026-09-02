import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MissingColumnsError, parseCsv } from '../src/index';
import { collect } from './helpers';

const Person = z.object({
    name: z.string(),
    age: z.coerce.number(),
    note: z.string().optional(),
});

describe('emptyAs', () => {
    const Optional = z.object({ name: z.string(), note: z.string().optional() });

    it('keeps blank cells as empty strings by default', async () => {
        expect(await collect(Optional, 'name,note\na,\n')).toEqual([{ name: 'a', note: '' }]);
    });

    it("lets a blank cell satisfy .optional() under 'undefined'", async () => {
        expect(await collect(Optional, 'name,note\na,\n', { emptyAs: 'undefined' })).toEqual([
            { name: 'a' },
        ]);
    });

    it("feeds .nullable() under 'null'", async () => {
        const Nullable = z.object({ name: z.string(), note: z.string().nullable() });

        expect(await collect(Nullable, 'name,note\na,\n', { emptyAs: 'null' })).toEqual([
            { name: 'a', note: null },
        ]);
    });

    it("triggers .default() under 'undefined'", async () => {
        const Defaulted = z.object({ name: z.string(), note: z.string().default('none') });

        expect(await collect(Defaulted, 'name,note\na,\n', { emptyAs: 'undefined' })).toEqual([
            { name: 'a', note: 'none' },
        ]);
    });

    it('leaves cells that only look blank alone', async () => {
        expect(await collect(Optional, 'name,note\na, \n', { emptyAs: 'undefined' })).toEqual([
            { name: 'a', note: ' ' },
        ]);
    });
});

describe('checkHeaders', () => {
    it('fails fast when a required column is absent', async () => {
        const failure = await collect(Person, 'name,note\na,x\nb,y\n').catch(
            (error: Error) => error
        );

        expect(failure).toBeInstanceOf(MissingColumnsError);
        expect((failure as MissingColumnsError).missing).toEqual(['age']);
        expect((failure as MissingColumnsError).columns).toEqual(['name', 'note']);
        expect((failure as MissingColumnsError).message).toContain('age');
    });

    it('does not require a column an optional field could do without', async () => {
        expect(await collect(Person, 'name,age\na,1\n')).toEqual([{ name: 'a', age: 1 }]);
    });

    it('reports every missing column at once', async () => {
        const failure = await collect(Person, 'note\nx\n').catch((error: Error) => error);

        expect((failure as MissingColumnsError).missing).toEqual(['name', 'age']);
    });

    it('fails whatever the invalid-row strategy is', async () => {
        await expect(
            collect(Person, 'name,note\na,x\n', { onInvalidRow: 'skip' })
        ).rejects.toBeInstanceOf(MissingColumnsError);
    });

    it('accepts an explicit list of columns to require', async () => {
        const Loose = z.record(z.string(), z.string());

        await expect(
            collect(Loose, 'name,note\na,x\n', { checkHeaders: ['name', 'email'] })
        ).rejects.toBeInstanceOf(MissingColumnsError);
    });

    it('checks the columns given through options too', async () => {
        await expect(
            collect(Person, 'a,x\n', { headers: ['name', 'note'] })
        ).rejects.toBeInstanceOf(MissingColumnsError);
    });

    it('can be turned off', async () => {
        const { rows, errors } = await parseCsv('name,note\na,x\n', Person, {
            checkHeaders: false,
        });

        expect(rows).toEqual([]);
        expect(errors[0]!.name).toBe('RowValidationError');
    });

    it('stays out of the way of a schema with no shape to read', async () => {
        const Loose = z.record(z.string(), z.string());

        expect(await collect(Loose, 'name,note\na,x\n')).toEqual([{ name: 'a', note: 'x' }]);
    });
});

describe('parse escape hatch', () => {
    it('passes options straight through to csv-parse', async () => {
        const rows = await collect(Person, 'junk line\nname,age\na,1\n', {
            parse: { from_line: 2 },
        });

        expect(rows).toEqual([{ name: 'a', age: 1 }]);
    });

    it('stops early on to_line without touching the schema', async () => {
        const rows = await collect(Person, 'name,age\na,1\nb,2\nc,3\n', {
            parse: { to_line: 3 },
        });

        expect(rows).toEqual([
            { name: 'a', age: 1 },
            { name: 'b', age: 2 },
        ]);
    });

    it('guards a runaway record with max_record_size', async () => {
        const text = `name,age\n"${'x'.repeat(5000)}",1\n`;

        await expect(collect(Person, text, { parse: { max_record_size: 100 } })).rejects.toThrow(
            /Max Record Size/i
        );
    });

    it('cannot take over the options the library depends on', async () => {
        const rows = await collect(Person, 'name;age\na;1\n', {
            delimiter: ';',
            parse: { delimiter: ',', columns: false, raw: false, info: false },
        });

        expect(rows).toEqual([{ name: 'a', age: 1 }]);
    });

    it('is overridden by a dedicated option, and fills in when there is none', async () => {
        const trimmed = await collect(Person, 'name,age\n a , 1 \n', {
            trim: true,
            parse: { trim: false },
        });

        expect(trimmed).toEqual([{ name: 'a', age: 1 }]);

        const sniffed = await collect(Person, "name;age\n'a;b';1\n", {
            delimiter: 'auto',
            parse: { quote: "'" },
        });

        expect(sniffed).toEqual([{ name: 'a;b', age: 1 }]);
    });
});
