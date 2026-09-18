import type { StandardSchemaV1 } from '../standard';
import type { CsvRowError } from '../errors';
import { collecting } from '../types';
import type { CsvRow, CsvStats, CsvValidatorOptions, MetaOptions } from '../types';
import { createCsvValidator } from './index';

export interface ParseCsvResult<Out> {
    rows: Out[];
    errors: readonly CsvRowError[];
    droppedErrors: number;
    stats: CsvStats;
}

/**
 * Parses a whole CSV held in memory. Invalid rows are collected rather than
 * thrown, so both halves come back.
 */
export function parseCsv<S extends StandardSchemaV1>(
    input: string | Uint8Array,
    schema: S,
    options: MetaOptions
): Promise<ParseCsvResult<CsvRow<StandardSchemaV1.InferOutput<S>>>>;
export function parseCsv<S extends StandardSchemaV1>(
    input: string | Uint8Array,
    schema: S,
    options?: CsvValidatorOptions
): Promise<ParseCsvResult<StandardSchemaV1.InferOutput<S>>>;
export async function parseCsv<S extends StandardSchemaV1>(
    input: string | Uint8Array,
    schema: S,
    options: CsvValidatorOptions = {}
): Promise<ParseCsvResult<StandardSchemaV1.InferOutput<S>>> {
    const text = typeof input === 'string';
    const bytes = text ? new TextEncoder().encode(input) : input;
    const validator = createCsvValidator(
        schema,
        collecting(text ? { ...options, encoding: undefined } : options)
    );
    const rows: StandardSchemaV1.InferOutput<S>[] = [];

    const source = new ReadableStream<Uint8Array>({
        start(controller) {
            if (bytes.length) controller.enqueue(bytes);
            controller.close();
        },
    });

    for await (const row of source.pipeThrough(validator)) rows.push(row);

    return {
        rows,
        errors: validator.errors,
        droppedErrors: validator.droppedErrors,
        stats: validator.stats,
    };
}
