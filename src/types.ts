import type { Options } from 'csv-parse';

import type { CsvRowError } from './errors';
import { assertHeaderCase } from './headers';

export type InvalidRowStrategy = 'error' | 'skip' | 'collect';

export type EmptyCellValue = 'keep' | 'undefined' | 'null';

export type HeaderCase = 'trim' | 'lower' | 'snake' | 'camel';

export type HeaderMapper = (header: string, index: number) => string;

export interface CsvRow<Out> {
    row: Out;
    line: number;
    record: number;
}

export interface CsvValidatorOptions {
    delimiter?: (string & {}) | 'auto';
    headers?: true | string[];
    checkHeaders?: boolean | string[];
    normalizeHeaders?: HeaderCase | HeaderMapper;
    columnAliases?: Readonly<Record<string, string>>;
    encoding?: string;
    emptyAs?: EmptyCellValue;
    async?: boolean;
    withMeta?: boolean;
    onInvalidRow?: InvalidRowStrategy;
    maxErrors?: number;
    keepErrors?: number;
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

export type MetaOptions = CsvValidatorOptions & { withMeta: true };

export const DEFAULT_KEPT_ERRORS = 1000;

export interface ResolvedOptions extends CsvValidatorOptions {
    delimiter: (string & {}) | 'auto';
    headers: true | string[];
    checkHeaders: boolean | string[];
    emptyAs: EmptyCellValue;
    async: boolean;
    withMeta: boolean;
    onInvalidRow: InvalidRowStrategy;
    maxErrors: number;
    keepErrors: number;
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

const EMPTY_AS: readonly EmptyCellValue[] = ['keep', 'undefined', 'null'];
const STRATEGIES: readonly InvalidRowStrategy[] = ['error', 'skip', 'collect'];

function choice<T extends string>(name: string, value: T, allowed: readonly T[]): T {
    if (!allowed.includes(value))
        throw new RangeError(
            `Unknown ${name} ${JSON.stringify(value)} — expected ${allowed.join(', ')}`
        );

    return value;
}

function count(name: string, value: number): number {
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0)
        throw new RangeError(
            `${name} must be a non-negative number or Infinity, got ${String(value)}`
        );

    return value;
}

function delimiterOf(value: (string & {}) | 'auto'): (string & {}) | 'auto' {
    if (typeof value !== 'string' || value === '')
        throw new RangeError(`delimiter must be a non-empty string or 'auto'`);

    return value;
}

function checkHeaderOptions(options: CsvValidatorOptions): void {
    const { normalizeHeaders, headers } = options;

    if (typeof normalizeHeaders === 'string') assertHeaderCase(normalizeHeaders);

    if (Array.isArray(headers) && headers.some(header => typeof header !== 'string'))
        throw new RangeError('headers must be true or an array of column names');
}

export function resolveOptions(options: CsvValidatorOptions = {}): ResolvedOptions {
    const { parse } = options;

    checkHeaderOptions(options);

    return {
        ...options,
        delimiter: delimiterOf(options.delimiter ?? ','),
        headers: options.headers ?? true,
        checkHeaders: options.checkHeaders ?? true,
        emptyAs: choice('emptyAs', options.emptyAs ?? 'keep', EMPTY_AS),
        async: options.async ?? false,
        withMeta: options.withMeta ?? false,
        onInvalidRow: choice('onInvalidRow', options.onInvalidRow ?? 'error', STRATEGIES),
        maxErrors: count('maxErrors', options.maxErrors ?? Infinity),
        keepErrors: count('keepErrors', options.keepErrors ?? DEFAULT_KEPT_ERRORS),
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
