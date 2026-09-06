import { RowParseError, RowValidationError } from './errors';
import type { CsvRowError } from './errors';

export interface RejectsCsvOptions {
    delimiter?: string;
    eol?: string;
    header?: boolean;
    bom?: boolean;
}

const COLUMNS = ['line', 'record', 'error', 'code', 'field', 'message', 'raw'];

const SPECIAL = /["\r\n]/;

function escape(value: string, delimiter: string): string {
    return SPECIAL.test(value) || value.includes(delimiter)
        ? `"${value.replace(/"/g, '""')}"`
        : value;
}

function fieldsOf(error: CsvRowError): string {
    if (!(error instanceof RowValidationError)) return '';

    const paths = error.zodError.issues
        .map(issue => issue.path.map(String).join('.'))
        .filter(path => path !== '');

    return [...new Set(paths)].join('; ');
}

function cellsOf(error: CsvRowError): string[] {
    return [
        String(error.line),
        error instanceof RowValidationError ? String(error.record) : '',
        error.name,
        error instanceof RowParseError ? error.code : '',
        fieldsOf(error),
        error.message,
        error.raw,
    ];
}

export function rejectsCsv(
    errors: readonly CsvRowError[],
    options: RejectsCsvOptions = {}
): string {
    const { delimiter = ',', eol = '\n', header = true, bom = false } = options;
    const lines: string[] = [];

    if (header) lines.push(COLUMNS.join(delimiter));

    for (const error of errors)
        lines.push(
            cellsOf(error)
                .map(cell => escape(cell, delimiter))
                .join(delimiter)
        );

    if (!lines.length) return bom ? '﻿' : '';

    return (bom ? '﻿' : '') + lines.join(eol) + eol;
}
