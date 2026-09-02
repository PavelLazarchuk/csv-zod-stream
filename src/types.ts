import type { RowValidationError } from './errors';

export type InvalidRowStrategy = 'error' | 'skip' | 'collect';

export interface CsvValidatorOptions {
    delimiter?: (string & {}) | 'auto';
    headers?: true | string[];
    onInvalidRow?: InvalidRowStrategy;
    maxErrors?: number;
    onRowError?: (error: RowValidationError) => void;
    bom?: boolean;
    skipEmptyLines?: boolean;
    relaxColumnCount?: boolean;
    trim?: boolean;
    quote?: string;
    escape?: string;
    comment?: string;
}

export interface ResolvedOptions extends CsvValidatorOptions {
    delimiter: (string & {}) | 'auto';
    headers: true | string[];
    onInvalidRow: InvalidRowStrategy;
    maxErrors: number;
    bom: boolean;
    skipEmptyLines: boolean;
    relaxColumnCount: boolean;
    trim: boolean;
}

export function resolveOptions(options: CsvValidatorOptions = {}): ResolvedOptions {
    return {
        ...options,
        delimiter: options.delimiter ?? ',',
        headers: options.headers ?? true,
        onInvalidRow: options.onInvalidRow ?? 'error',
        maxErrors: options.maxErrors ?? Infinity,
        bom: options.bom ?? true,
        skipEmptyLines: options.skipEmptyLines ?? true,
        relaxColumnCount: options.relaxColumnCount ?? false,
        trim: options.trim ?? false,
    };
}
