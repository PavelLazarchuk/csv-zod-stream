import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MissingColumnsError, parseCsv } from '../src/index';
import { parseCsv as webParseCsv } from '../src/web/index';
import { collect } from './helpers';

const Person = z.object({ firstName: z.string(), age: z.coerce.number() });

describe('normalizeHeaders', () => {
    it("folds spacing and case into camelCase under 'camel'", async () => {
        expect(
            await collect(Person, 'First Name , AGE \nAda,36\n', { normalizeHeaders: 'camel' })
        ).toEqual([{ firstName: 'Ada', age: 36 }]);
    });

    it("folds the same headers into snake_case under 'snake'", async () => {
        const Snake = z.object({ first_name: z.string(), age: z.coerce.number() });

        expect(
            await collect(Snake, 'First Name,age\nAda,36\n', {
                normalizeHeaders: 'snake',
            })
        ).toEqual([{ first_name: 'Ada', age: 36 }]);
    });

    it("only strips surrounding whitespace under 'trim'", async () => {
        const Spaced = z.object({ 'First Name': z.string() });

        expect(
            await collect(Spaced, '  First Name  \nAda\n', { normalizeHeaders: 'trim' })
        ).toEqual([{ 'First Name': 'Ada' }]);
    });

    it("lowercases under 'lower'", async () => {
        const Lower = z.object({ name: z.string() });

        expect(await collect(Lower, 'NAME\nAda\n', { normalizeHeaders: 'lower' })).toEqual([
            { name: 'Ada' },
        ]);
    });

    it('splits camelCase and keeps non-latin letters', async () => {
        const Mixed = z.object({ user_id: z.coerce.number(), имя: z.string() });

        expect(await collect(Mixed, 'userID,Имя\n7,Ада\n', { normalizeHeaders: 'snake' })).toEqual([
            { user_id: 7, имя: 'Ада' },
        ]);
    });

    it('takes a function', async () => {
        expect(
            await collect(Person, 'a,b\nAda,36\n', {
                normalizeHeaders: (_header, index) => (index === 0 ? 'firstName' : 'age'),
            })
        ).toEqual([{ firstName: 'Ada', age: 36 }]);
    });

    it('leaves a header with nothing to fold alone', async () => {
        const Odd = z.object({ '--': z.string() });

        expect(await collect(Odd, ' -- \nx\n', { normalizeHeaders: 'snake' })).toEqual([
            { '--': 'x' },
        ]);
    });

    it('rejects an unknown preset', async () => {
        await expect(
            collect(Person, 'a\n1\n', { normalizeHeaders: 'kebab' as 'snake' })
        ).rejects.toThrow(RangeError);
    });

    it('renames the columns the header check looks at', async () => {
        const failure = await collect(Person, 'First Name\nAda\n', {
            normalizeHeaders: 'camel',
        }).catch((error: Error) => error);

        expect(failure).toBeInstanceOf(MissingColumnsError);
        expect((failure as MissingColumnsError).columns).toEqual(['firstName']);
        expect((failure as MissingColumnsError).missing).toEqual(['age']);
    });
});

describe('columnAliases', () => {
    it('maps a file column onto a schema field', async () => {
        expect(
            await collect(Person, 'Full Name,Years\nAda,36\n', {
                columnAliases: { 'Full Name': 'firstName', Years: 'age' },
            })
        ).toEqual([{ firstName: 'Ada', age: 36 }]);
    });

    it('is checked against the original header first, then the normalized one', async () => {
        const rows = await collect(Person, 'E-Mail,age\nAda,36\n', {
            normalizeHeaders: 'camel',
            columnAliases: { eMail: 'firstName' },
        });

        expect(rows).toEqual([{ firstName: 'Ada', age: 36 }]);

        const raw = await collect(Person, 'E-Mail,age\nAda,36\n', {
            normalizeHeaders: 'camel',
            columnAliases: { 'E-Mail': 'firstName' },
        });

        expect(raw).toEqual([{ firstName: 'Ada', age: 36 }]);
    });

    it('leaves columns it does not name alone', async () => {
        const { rows } = await parseCsv('name,age\nAda,36\n', z.object({ who: z.string() }), {
            columnAliases: { name: 'who' },
            checkHeaders: false,
        });

        expect(rows).toEqual([{ who: 'Ada' }]);
    });

    it('applies to an explicit headers array', async () => {
        expect(
            await collect(Person, 'Ada,36\n', {
                headers: ['Full Name', 'age'],
                columnAliases: { 'Full Name': 'firstName' },
            })
        ).toEqual([{ firstName: 'Ada', age: 36 }]);
    });

    it('works the same on the web build', async () => {
        const { rows } = await webParseCsv('First Name,AGE\nAda,36\n', Person, {
            normalizeHeaders: 'camel',
        });

        expect(rows).toEqual([{ firstName: 'Ada', age: 36 }]);
    });
});
