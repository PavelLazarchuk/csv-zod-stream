import type { CsvError, Options } from 'csv-parse';

import { createHeaderMapper } from './headers';
import type { ResolvedOptions } from './types';

export type SkipHandler = (error: CsvError | undefined, raw: string | undefined) => undefined;

function columnsOf(options: ResolvedOptions): Options['columns'] {
    const map = createHeaderMapper(options);

    if (!map) return options.headers;
    if (options.headers === true) return (record: string[]) => record.map((h, i) => map(h, i));

    return options.headers.map((h, i) => map(h, i));
}

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
        columns: columnsOf(options),
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
