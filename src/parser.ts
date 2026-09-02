import type { CsvError, Options } from 'csv-parse';

import type { ResolvedOptions } from './types';

export type SkipHandler = (error: CsvError | undefined, raw: string | undefined) => undefined;

/**
 * Maps the public options onto `csv-parse`, on top of whatever `options.parse`
 * carries. `info` and `raw` are always on: they are what makes a physical line
 * number and the offending text available on the row errors.
 */
export function parserOptions(
    options: ResolvedOptions,
    delimiter: string,
    onSkip?: SkipHandler
): Options {
    const controlled: Options = {
        delimiter,
        columns: options.headers,
        bom: options.bom,
        skip_empty_lines: options.skipEmptyLines,
        relax_column_count: options.relaxColumnCount,
        trim: options.trim,
        skip_records_with_error: options.skipRecordsWithError,
        info: true,
        raw: true,
    };

    if (options.quote !== undefined) controlled.quote = options.quote;
    if (options.escape !== undefined) controlled.escape = options.escape;
    if (options.comment !== undefined) controlled.comment = options.comment;
    if (options.skipRecordsWithError && onSkip) controlled.on_skip = onSkip;

    return { ...options.parse, ...controlled };
}
