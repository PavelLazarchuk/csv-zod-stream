import { describe, expect, it } from 'vitest';
import * as m from 'zod/mini';
import { z } from 'zod';

import {
    MissingColumnsError,
    RowValidationError,
    UnknownColumnsError,
    parseCsv,
    rejectsCsv,
} from '../src/index';
import type { StandardSchemaV1 } from '../src/index';
import { parseCsv as webParseCsv } from '../src/web/index';
import { validationErrors } from './helpers';

interface Person {
    name: string;
    age: number;
}

function handRolled(options: { async?: boolean } = {}): StandardSchemaV1<unknown, Person> {
    const validate = (value: unknown): StandardSchemaV1.Result<Person> => {
        const row = value as Record<string, unknown>;
        const issues: StandardSchemaV1.Issue[] = [];

        if (typeof row.name !== 'string' || row.name === '')
            issues.push({ message: 'expected a name', path: ['name'] });

        const age = Number(row.age);

        if (!Number.isFinite(age))
            issues.push({ message: 'expected a number', path: [{ key: 'age' }] });

        if (issues.length) return { issues };

        return { value: { name: row.name as string, age } };
    };

    return {
        '~standard': {
            version: 1,
            vendor: 'hand-rolled',
            validate: options.async ? value => Promise.resolve(validate(value)) : validate,
        },
    };
}

describe('Standard Schema', () => {
    it('validates rows through a schema that is only a Standard Schema', async () => {
        const { rows, errors } = await parseCsv('name,age\nAda,36\n,nope\n', handRolled(), {
            onInvalidRow: 'collect',
        });

        expect(rows).toEqual([{ name: 'Ada', age: 36 }]);
        expect(errors).toHaveLength(1);
    });

    it('reads the issues, whichever way the path is spelled', async () => {
        const { errors } = await parseCsv('name,age\n,nope\n', handRolled(), {
            onInvalidRow: 'collect',
        });

        const [error] = validationErrors(errors);

        expect(error?.issues).toEqual([
            { path: ['name'], message: 'expected a name' },
            { path: ['age'], message: 'expected a number' },
        ]);
        expect(error?.message).toContain('name: expected a name');
        expect(error?.zodError).toBeUndefined();
    });

    it('awaits a schema that answers with a promise, without being told to', async () => {
        const { rows, errors } = await parseCsv(
            'name,age\nAda,36\n,nope\n',
            handRolled({ async: true }),
            {
                onInvalidRow: 'collect',
            }
        );

        expect(rows).toEqual([{ name: 'Ada', age: 36 }]);
        expect(errors).toHaveLength(1);
    });

    it('puts the field names in the rejects file, without a ZodError to read', async () => {
        const { errors } = await parseCsv('name,age\n,nope\n', handRolled(), {
            onInvalidRow: 'collect',
        });

        expect(rejectsCsv(errors)).toContain('name; age');
    });

    it('takes zod/mini, which is the reason the contract is worth having', async () => {
        const Mini = m.object({ name: m.string(), age: m.coerce.number() });

        const { rows, errors } = await parseCsv('name,age\nAda,36\nGrace,nope\n', Mini, {
            onInvalidRow: 'collect',
        });

        expect(rows).toEqual([{ name: 'Ada', age: 36 }]);
        expect(validationErrors(errors)[0]?.issues[0]?.path).toEqual(['age']);
    });

    it('still hands Zod users a real ZodError', async () => {
        const Person = z.object({ name: z.string(), age: z.coerce.number() });

        const { errors } = await parseCsv('name,age\nGrace,nope\n', Person, {
            onInvalidRow: 'collect',
        });

        const [error] = validationErrors(errors);

        expect(error?.zodError).toBeInstanceOf(z.ZodError);
        expect(error?.issues[0]?.path).toEqual(['age']);
    });

    it('reads the header of a zod/mini schema, which keeps its fields in `shape`', async () => {
        const Mini = m.object({ name: m.string(), age: m.coerce.number() });

        const missing = await parseCsv('name\nAda\n', Mini).catch((error: unknown) => error);

        expect(missing).toBeInstanceOf(MissingColumnsError);
        expect((missing as MissingColumnsError).missing).toEqual(['age']);

        const unknown = await parseCsv('name,age,extra\nAda,36,x\n', Mini, {
            unknownColumns: 'error',
        }).catch((error: unknown) => error);

        expect(unknown).toBeInstanceOf(UnknownColumnsError);
    });

    it('reads the header of a schema that keeps its fields in `entries`, Valibot-style', async () => {
        const field = (required: boolean): StandardSchemaV1<unknown, string> => ({
            '~standard': {
                version: 1,
                vendor: 'hand-rolled',
                validate: value =>
                    value === undefined && required
                        ? { issues: [{ message: 'required' }] }
                        : { value: String(value ?? '') },
            },
        });

        const Valibot = {
            entries: { name: field(true), nickname: field(false) },
            '~standard': handRolled()['~standard'],
        };

        const missing = await parseCsv('nickname\nAda\n', Valibot).catch((error: unknown) => error);

        expect(missing).toBeInstanceOf(MissingColumnsError);
        expect((missing as MissingColumnsError).missing).toEqual(['name']);

        const unknown = await parseCsv('name,age\nAda,36\n', Valibot, {
            unknownColumns: 'error',
        }).catch((error: unknown) => error);

        expect((unknown as UnknownColumnsError).unknown).toEqual(['age']);
    });

    it('stands down from the missing-column check when a field answers asynchronously', async () => {
        const slow: StandardSchemaV1<unknown, string> = {
            '~standard': {
                version: 1,
                vendor: 'hand-rolled',
                validate: value => Promise.resolve({ value: String(value ?? '') }),
            },
        };

        const schema = { entries: { name: slow }, '~standard': handRolled()['~standard'] };

        const { rows } = await parseCsv('name,age\nAda,36\n', schema);

        expect(rows).toEqual([{ name: 'Ada', age: 36 }]);
    });

    it('leaves a schema it cannot read the shape of alone', async () => {
        const { rows } = await parseCsv('name,age\nAda,36\n', handRolled(), {
            unknownColumns: 'error',
        });

        expect(rows).toHaveLength(1);
    });

    it('reaches the web build the same way', async () => {
        const { rows } = await webParseCsv('name,age\nAda,36\n', handRolled());

        expect(rows).toEqual([{ name: 'Ada', age: 36 }]);
    });

    it('refuses something that is neither, where it is passed', async () => {
        await expect(parseCsv('name\nAda\n', {} as never)).rejects.toBeInstanceOf(TypeError);
    });

    it('still fails the stream with a RowValidationError when asked to', async () => {
        await expect(
            parseCsv('name,age\n,nope\n', handRolled(), { onInvalidRow: 'error' })
        ).rejects.toBeInstanceOf(RowValidationError);
    });
});
