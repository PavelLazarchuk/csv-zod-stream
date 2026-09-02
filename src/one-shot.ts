import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ZodType, output } from 'zod';

import type { CsvRowError } from './errors';
import { createCsvValidator } from './transform';
import type { CsvValidatorOptions } from './types';

export interface ParseCsvResult<Out> {
    rows: Out[];
    errors: readonly CsvRowError[];
}

function collecting(options: CsvValidatorOptions): CsvValidatorOptions {
    return { onInvalidRow: 'collect', ...options };
}

async function drain<S extends ZodType>(
    source: Readable,
    schema: S,
    options: CsvValidatorOptions
): Promise<ParseCsvResult<output<S>>> {
    const stream = createCsvValidator(schema, collecting(options));
    const rows: output<S>[] = [];

    await pipeline(source, stream, async (validated: AsyncIterable<output<S>>) => {
        for await (const row of validated) rows.push(row);
    });

    return { rows, errors: stream.errors };
}

/**
 * Parses a whole CSV held in memory. For anything big enough to care about,
 * use {@link createCsvValidator} and keep it streaming.
 */
export function parseCsv<S extends ZodType>(
    input: string | Uint8Array,
    schema: S,
    options: CsvValidatorOptions = {}
): Promise<ParseCsvResult<output<S>>> {
    const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;

    return drain(Readable.from([bytes], { objectMode: false }), schema, options);
}

/** Reads and parses a CSV file, streaming it off disk. */
export function parseCsvFile<S extends ZodType>(
    path: string,
    schema: S,
    options: CsvValidatorOptions = {}
): Promise<ParseCsvResult<output<S>>> {
    return drain(createReadStream(path), schema, options);
}
