import { RowParseError, RowValidationError } from './errors';
import type { CsvRowError } from './errors';

export interface RejectsCsvOptions {
    delimiter?: string;
    eol?: string;
    header?: boolean;
    bom?: boolean;
    escapeFormulas?: boolean;
}

const COLUMNS = ['line', 'record', 'error', 'code', 'field', 'message', 'raw'];

const SPECIAL = /["\r\n]/;

const FORMULA = /^[=+\-@\t\r]/;

function escape(value: string, delimiter: string, formulas: boolean): string {
    const text = formulas && FORMULA.test(value) ? `'${value}` : value;

    return SPECIAL.test(text) || text.includes(delimiter) ? `"${text.replace(/"/g, '""')}"` : text;
}

function fieldsOf(error: CsvRowError): string {
    if (!(error instanceof RowValidationError)) return '';

    const paths = error.issues
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
    const {
        delimiter = ',',
        eol = '\n',
        header = true,
        bom = false,
        escapeFormulas = true,
    } = options;
    const lines: string[] = [];

    if (header) lines.push(COLUMNS.join(delimiter));

    for (const error of errors)
        lines.push(
            cellsOf(error)
                .map(cell => escape(cell, delimiter, escapeFormulas))
                .join(delimiter)
        );

    if (!lines.length) return bom ? '﻿' : '';

    return (bom ? '﻿' : '') + lines.join(eol) + eol;
}
