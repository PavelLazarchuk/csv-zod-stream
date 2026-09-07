import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ZodType, output } from 'zod';

import type { CsvRowError } from './errors';
import { ZodCsvTransform } from './transform';
import { collecting } from './types';
import type { CsvRow, CsvValidatorOptions, MetaOptions } from './types';

export interface ParseCsvResult<Out> {
    rows: Out[];
    errors: readonly CsvRowError[];
    droppedErrors: number;
}

async function drain<S extends ZodType, Out>(
    source: Readable,
    schema: S,
    options: CsvValidatorOptions
): Promise<ParseCsvResult<Out>> {
    const stream = new ZodCsvTransform<S, Out>(schema, collecting(options));
    const rows: Out[] = [];

    await pipeline(source, stream, async (validated: AsyncIterable<Out>) => {
        for await (const row of validated) rows.push(row);
    });

    return { rows, errors: stream.errors, droppedErrors: stream.droppedErrors };
}

/**
 * Parses a whole CSV held in memory. For anything big enough to care about,
 * use {@link createCsvValidator} and keep it streaming.
 */
export function parseCsv<S extends ZodType>(
    input: string | Uint8Array,
    schema: S,
    options: MetaOptions
): Promise<ParseCsvResult<CsvRow<output<S>>>>;
export function parseCsv<S extends ZodType>(
    input: string | Uint8Array,
    schema: S,
    options?: CsvValidatorOptions
): Promise<ParseCsvResult<output<S>>>;
export function parseCsv<S extends ZodType>(
    input: string | Uint8Array,
    schema: S,
    options: CsvValidatorOptions = {}
): Promise<ParseCsvResult<output<S>>> {
    const text = typeof input === 'string';
    const bytes = text ? Buffer.from(input, 'utf8') : input;

    return drain(
        Readable.from([bytes], { objectMode: false }),
        schema,
        text ? { ...options, encoding: undefined } : options
    );
}

/** Reads and parses a CSV file, streaming it off disk. */
export function parseCsvFile<S extends ZodType>(
    path: string,
    schema: S,
    options: MetaOptions
): Promise<ParseCsvResult<CsvRow<output<S>>>>;
export function parseCsvFile<S extends ZodType>(
    path: string,
    schema: S,
    options?: CsvValidatorOptions
): Promise<ParseCsvResult<output<S>>>;
export function parseCsvFile<S extends ZodType>(
    path: string,
    schema: S,
    options: CsvValidatorOptions = {}
): Promise<ParseCsvResult<output<S>>> {
    return drain(createReadStream(path), schema, options);
}
