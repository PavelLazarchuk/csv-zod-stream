import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { assertType, describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { batched, createCsvValidator, parseCsv, parseCsvFile } from '../src/index';
import type { CsvRow, CsvRowError } from '../src/index';
import { createCsvValidator as createWebCsvValidator } from '../src/web/index';
import { batched as webBatched } from '../src/web/index';

const Row = z.object({ id: z.coerce.number(), name: z.string() });

type Row = { id: number; name: string };

describe('types', () => {
    it('infers the row type from the schema', () => {
        const stream = createCsvValidator(Row);

        expectTypeOf(stream.errors).toEqualTypeOf<readonly CsvRowError[]>();
        stream.on('invalid-row', error => expectTypeOf(error).toEqualTypeOf<CsvRowError>());
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

    it('types the one-shot result off the schema', async () => {
        const { rows, errors } = await parseCsv('id,name\n1,a\n', Row);

        expectTypeOf(rows).toEqualTypeOf<Row[]>();
        expectTypeOf(errors).toEqualTypeOf<readonly CsvRowError[]>();
    });

    it('groups rows into arrays of the row type', () => {
        expectTypeOf(webBatched<Row>(2).readable).toEqualTypeOf<ReadableStream<Row[]>>();
        batched<Row>(2).on('data', batch => expectTypeOf(batch).toEqualTypeOf<Row[]>());
    });

    it('wraps the row type when withMeta is on', async () => {
        const stream = createCsvValidator(Row, { withMeta: true });

        stream.on('data', row => expectTypeOf(row).toEqualTypeOf<CsvRow<Row>>());

        const { rows } = await parseCsv('id,name\n1,a\n', Row, { withMeta: true });

        expectTypeOf(rows).toEqualTypeOf<CsvRow<Row>[]>();

        const fromFile = await parseCsvFile('x.csv', Row, { withMeta: true });

        expectTypeOf(fromFile.rows).toEqualTypeOf<CsvRow<Row>[]>();

        const web = createWebCsvValidator(Row, { withMeta: true });

        expectTypeOf(web.readable).toEqualTypeOf<ReadableStream<CsvRow<Row>>>();
    });

    it('leaves the row type alone without withMeta', () => {
        const stream = createCsvValidator(Row, { async: true, encoding: 'latin1' });

        stream.on('data', row => expectTypeOf(row).toEqualTypeOf<Row>());
    });

    it('carries the output type, not the input type, through coercion', () => {
        const Coerced = z.object({ n: z.coerce.number() });
        const validator = createWebCsvValidator(Coerced);

        expectTypeOf(validator.readable).toEqualTypeOf<ReadableStream<{ n: number }>>();
    });
});
