import type { Options } from 'csv-parse';

import type { CsvRowError } from './errors';

export type InvalidRowStrategy = 'error' | 'skip' | 'collect';

export type EmptyCellValue = 'keep' | 'undefined' | 'null';

export interface CsvValidatorOptions {
    delimiter?: (string & {}) | 'auto';
    headers?: true | string[];
    checkHeaders?: boolean | string[];
    emptyAs?: EmptyCellValue;
    onInvalidRow?: InvalidRowStrategy;
    maxErrors?: number;
    onRowError?: (error: CsvRowError) => void;
    skipRecordsWithError?: boolean;
    bom?: boolean;
    skipEmptyLines?: boolean;
    relaxColumnCount?: boolean;
    trim?: boolean;
    quote?: string;
    escape?: string;
    comment?: string;
    parse?: Options;
}

export interface ResolvedOptions extends CsvValidatorOptions {
    delimiter: (string & {}) | 'auto';
    headers: true | string[];
    checkHeaders: boolean | string[];
    emptyAs: EmptyCellValue;
    onInvalidRow: InvalidRowStrategy;
    maxErrors: number;
    skipRecordsWithError: boolean;
    bom: boolean;
    skipEmptyLines: boolean;
    relaxColumnCount: boolean;
    trim: boolean;
}

export function collecting(options: CsvValidatorOptions): CsvValidatorOptions {
    return { ...options, onInvalidRow: options.onInvalidRow ?? 'collect' };
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

export function resolveOptions(options: CsvValidatorOptions = {}): ResolvedOptions {
    const { parse } = options;

    return {
        ...options,
        delimiter: options.delimiter ?? ',',
        headers: options.headers ?? true,
        checkHeaders: options.checkHeaders ?? true,
        emptyAs: options.emptyAs ?? 'keep',
        onInvalidRow: options.onInvalidRow ?? 'error',
        maxErrors: options.maxErrors ?? Infinity,
        skipRecordsWithError:
            options.skipRecordsWithError ?? parse?.skip_records_with_error ?? false,
        bom: options.bom ?? parse?.bom ?? true,
        skipEmptyLines: options.skipEmptyLines ?? parse?.skip_empty_lines ?? true,
        relaxColumnCount: options.relaxColumnCount ?? parse?.relax_column_count ?? false,
        trim: options.trim ?? parse?.trim ?? false,
        quote: options.quote ?? asString(parse?.quote),
        escape: options.escape ?? asString(parse?.escape),
        comment: options.comment ?? asString(parse?.comment),
    };
}
