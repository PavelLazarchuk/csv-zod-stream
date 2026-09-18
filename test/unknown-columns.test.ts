import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MissingColumnsError, UnknownColumnsError, parseCsv } from '../src/index';
import { parseCsv as webParseCsv } from '../src/web/index';

const Person = z.object({
    name: z.string(),
    email: z.string(),
    nickname: z.string().optional(),
});

afterEach(() => void vi.restoreAllMocks());

async function failure(text: string, options = {}) {
    return await parseCsv(text, Person, options).catch((error: unknown) => error);
}

describe('unknownColumns', () => {
    it('ignores a column the schema has never heard of by default', async () => {
        const { rows } = await parseCsv('name,email,extra\nAda,ada@example.com,x\n', Person);

        expect(rows).toEqual([{ name: 'Ada', email: 'ada@example.com' }]);
    });

    it("stops the file before the first row under 'error'", async () => {
        const error = await failure('name,email,extra\nAda,ada@example.com,x\n', {
            unknownColumns: 'error',
        });

        expect(error).toBeInstanceOf(UnknownColumnsError);
        expect((error as UnknownColumnsError).unknown).toEqual(['extra']);
        expect((error as UnknownColumnsError).columns).toEqual(['name', 'email', 'extra']);
    });

    it('counts an optional field as known', async () => {
        const { rows } = await parseCsv('name,email,nickname\nAda,ada@example.com,A\n', Person, {
            unknownColumns: 'error',
        });

        expect(rows).toHaveLength(1);
    });

    it("keeps going under 'warn', saying it once", async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const { rows } = await parseCsv(
            'name,email,extra\nAda,ada@example.com,x\nAlan,alan@example.com,y\n',
            Person,
            { unknownColumns: 'warn' }
        );

        expect(rows).toHaveLength(2);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toMatch(/unknown column extra/);
    });

    it('measures against the explicit list when `checkHeaders` names one', async () => {
        const error = await failure('name,email,extra\nAda,ada@example.com,x\n', {
            checkHeaders: ['name', 'email'],
            unknownColumns: 'error',
        });

        expect(error).toBeInstanceOf(UnknownColumnsError);
    });

    it('says nothing at all when the header check is off', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await parseCsv('name,email,extra\nAda,ada@example.com,x\n', Person, {
            checkHeaders: false,
            unknownColumns: 'warn',
        });

        expect(warn).not.toHaveBeenCalled();
    });

    it('sees the renamed columns, not the ones in the file', async () => {
        const { rows } = await parseCsv('Name,E-Mail\nAda,ada@example.com\n', Person, {
            normalizeHeaders: 'camel',
            columnAliases: { 'E-Mail': 'email' },
            unknownColumns: 'error',
        });

        expect(rows).toEqual([{ name: 'Ada', email: 'ada@example.com' }]);
    });

    it('refuses an unknown strategy where it is passed', async () => {
        await expect(parseCsv('', Person, { unknownColumns: 'shout' as never })).rejects.toThrow(
            RangeError
        );
    });

    it('reaches the web build too', async () => {
        const error = await webParseCsv('name,email,extra\nAda,a@b.c,x\n', Person, {
            unknownColumns: 'error',
        }).catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(UnknownColumnsError);
    });
});

describe('did you mean', () => {
    it('names the file column a missing one was probably meant to be', async () => {
        const error = (await failure('name,emial\nAda,ada@example.com\n')) as MissingColumnsError;

        expect(error).toBeInstanceOf(MissingColumnsError);
        expect(error.suggestions).toEqual({ email: 'emial' });
        expect(error.message).toContain('did you mean "emial" for "email"');
    });

    it('names the schema field an unknown column was probably meant to be', async () => {
        const error = (await failure('name,email,nickmame\nAda,a@b.c,A\n', {
            unknownColumns: 'error',
        })) as UnknownColumnsError;

        expect(error.suggestions).toEqual({ nickmame: 'nickname' });
        expect(error.message).toContain('did you mean "nickname" for "nickmame"');
    });

    it('keeps quiet when nothing on the other side is close', async () => {
        const error = (await failure('name,phone\nAda,555\n')) as MissingColumnsError;

        expect(error.suggestions).toEqual({});
        expect(error.message).not.toContain('did you mean');
    });

    it('treats a difference of case alone as the closest match there is', async () => {
        const error = (await failure('name,Email\nAda,ada@example.com\n')) as MissingColumnsError;

        expect(error.suggestions).toEqual({ email: 'Email' });
    });

    it('keeps a column named after an object internal', async () => {
        const Tricky = z.object({ ['__proto__']: z.string(), constructor: z.string() });

        const error = (await parseCsv('__prote__,constructer\nx,y\n', Tricky).catch(
            (thrown: unknown) => thrown
        )) as MissingColumnsError;

        expect(Object.hasOwn(error.suggestions, '__proto__')).toBe(true);
        expect(error.suggestions['__proto__']).toBe('__prote__');
        expect(error.suggestions['constructor']).toBe('constructer');
    });

    it('allows more edits in a longer name than in a short one', async () => {
        const Wide = z.object({ id: z.string(), correspondenceAddress: z.string() });

        const error = (await parseCsv('di,correspondence_adress\n1,x\n', Wide).catch(
            (thrown: unknown) => thrown
        )) as MissingColumnsError;

        expect(error.suggestions).toEqual({
            id: 'di',
            correspondenceAddress: 'correspondence_adress',
        });
    });
});
