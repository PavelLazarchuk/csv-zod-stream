import type { CsvError, Options } from 'csv-parse';

import { createHeaderMapper } from './headers';
import type { ResolvedOptions } from './types';

export type SkipHandler = (error: CsvError | undefined, raw: string | undefined) => undefined;

export type ColumnsHandler = (columns: readonly string[], origin: 'file' | 'options') => void;

function columnsOf(options: ResolvedOptions, onColumns?: ColumnsHandler): Options['columns'] {
    const map = createHeaderMapper(options);
    const name = (header: string, index: number) => (map ? map(header, index) : header);

    if (options.headers !== true) {
        const named = options.headers.map(name);

        onColumns?.(named, 'options');

        return named;
    }

    return (record: string[]) => {
        const named = record.map(name);

        onColumns?.(named, 'file');

        return named;
    };
}

/**
 * Maps the public options onto `csv-parse`, on top of whatever `options.parse`
 * carries. `info` and `raw` are always on: they are what makes a physical line
 * number and the offending text available on the row errors.
 */
export function parserOptions(
    options: ResolvedOptions,
    delimiter: string,
    onSkip?: SkipHandler,
    onColumns?: ColumnsHandler
): Options {
    const controlled: Options = {
        delimiter,
        columns: columnsOf(options, onColumns),
        bom: options.bom,
        skip_empty_lines: options.skipEmptyLines,
        relax_column_count: options.relaxColumnCount,
        trim: options.trim,
        skip_records_with_error: options.skipRecordsWithError,
        info: true,
        raw: true,
    };

    if (options.encoding !== undefined) controlled.encoding = 'utf8';
    if (options.quote !== undefined) controlled.quote = options.quote;
    if (options.escape !== undefined) controlled.escape = options.escape;
    if (options.comment !== undefined) controlled.comment = options.comment;
    if (options.skipRecordsWithError && onSkip) controlled.on_skip = onSkip;

    return { ...options.parse, ...controlled };
}
