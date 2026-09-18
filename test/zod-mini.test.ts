import { describe, expect, it } from 'vitest';
import * as m from 'zod/mini';

import { MissingColumnsError, UnknownColumnsError, parseCsv } from '../src/index';
import { validationErrors } from './helpers';

describe('zod/mini', () => {
    it('takes zod/mini, which is the reason the contract is worth having', async () => {
        const Mini = m.object({ name: m.string(), age: m.coerce.number() });

        const { rows, errors } = await parseCsv('name,age\nAda,36\nGrace,nope\n', Mini, {
            onInvalidRow: 'collect',
        });

        expect(rows).toEqual([{ name: 'Ada', age: 36 }]);
        expect(validationErrors(errors)[0]?.issues[0]?.path).toEqual(['age']);
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
});
