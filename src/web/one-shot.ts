import type { ZodType, output } from 'zod';

import type { CsvRowError } from '../errors';
import { collecting } from '../types';
import type { CsvValidatorOptions } from '../types';
import { createCsvValidator } from './index';

export interface ParseCsvResult<Out> {
    rows: Out[];
    errors: readonly CsvRowError[];
}

/**
 * Parses a whole CSV held in memory. Invalid rows are collected rather than
 * thrown, so both halves come back.
 */
export async function parseCsv<S extends ZodType>(
    input: string | Uint8Array,
    schema: S,
    options: CsvValidatorOptions = {}
): Promise<ParseCsvResult<output<S>>> {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    const validator = createCsvValidator(schema, collecting(options));
    const rows: output<S>[] = [];

    const source = new ReadableStream<Uint8Array>({
        start(controller) {
            if (bytes.length) controller.enqueue(bytes);
            controller.close();
        },
    });

    for await (const row of source.pipeThrough(validator)) rows.push(row);

    return { rows, errors: validator.errors };
}
