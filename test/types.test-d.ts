import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { assertType, describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { createCsvValidator } from '../src/index';
import type { RowValidationError } from '../src/index';
import { createCsvValidator as createWebCsvValidator } from '../src/web/index';

const Row = z.object({ id: z.coerce.number(), name: z.string() });

type Row = { id: number; name: string };

describe('types', () => {
    it('infers the row type from the schema', () => {
        const stream = createCsvValidator(Row);

        expectTypeOf(stream.errors).toEqualTypeOf<readonly RowValidationError[]>();
        stream.on('invalid-row', error => expectTypeOf(error).toEqualTypeOf<RowValidationError>());
        stream.on('data', row => expectTypeOf(row).toEqualTypeOf<Row>());
    });

    it('is accepted by stream.pipeline', () => {
        assertType(pipeline(createReadStream('x.csv'), createCsvValidator(Row), process.stdout));
    });

    it('types the web pair on both sides', () => {
        const validator = createWebCsvValidator(Row);

        expectTypeOf(validator.readable).toEqualTypeOf<ReadableStream<Row>>();
        expectTypeOf(validator.writable).toEqualTypeOf<WritableStream<Uint8Array>>();
    });

    it('carries the output type, not the input type, through coercion', () => {
        const Coerced = z.object({ n: z.coerce.number() });
        const validator = createWebCsvValidator(Coerced);

        expectTypeOf(validator.readable).toEqualTypeOf<ReadableStream<{ n: number }>>();
    });
});
