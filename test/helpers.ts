import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ZodType, output } from 'zod';

import { createCsvValidator } from '../src/index';
import type { CsvValidatorOptions } from '../src/types';

export function sliced(text: string, size: number): Readable {
    const bytes = Buffer.from(text, 'utf8');

    return Readable.from(
        (function* () {
            for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
        })(),
        { objectMode: false }
    );
}

export async function collect<S extends ZodType>(
    schema: S,
    text: string,
    options?: CsvValidatorOptions,
    chunkSize = 5
): Promise<output<S>[]> {
    const rows: output<S>[] = [];

    await pipeline(
        sliced(text, chunkSize),
        createCsvValidator(schema, options),
        async (source: AsyncIterable<output<S>>) => {
            for await (const row of source) rows.push(row);
        }
    );

    return rows;
}
