import type { Options } from 'csv-parse';

import type { ResolvedOptions } from './types';

/**
 * Maps the public options onto `csv-parse`. `info` and `raw` are always on:
 * they are what makes a physical line number and the offending text available
 * on {@link RowValidationError}.
 */
export function parserOptions(options: ResolvedOptions, delimiter: string): Options {
    return {
        delimiter,
        columns: options.headers,
        bom: options.bom,
        skip_empty_lines: options.skipEmptyLines,
        relax_column_count: options.relaxColumnCount,
        trim: options.trim,
        quote: options.quote,
        escape: options.escape,
        comment: options.comment,
        info: true,
        raw: true,
    };
}
