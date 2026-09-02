import type { ZodError } from 'zod';

export abstract class CsvRowError extends Error {
    readonly line: number;
    readonly raw: string;

    constructor(message: string, line: number, raw: string) {
        super(message);

        this.line = line;
        this.raw = raw;
    }
}

function validationDetail(zodError: ZodError): string {
    const [first] = zodError.issues;
    const where = first?.path.map(String).join('.');
    const detail = first ? `${where ? `${where}: ` : ''}${first.message}` : 'invalid';
    const more = zodError.issues.length - 1;

    return detail + (more > 0 ? ` (+${more} more issue${more > 1 ? 's' : ''})` : '');
}

export class RowValidationError extends CsvRowError {
    readonly record: number;
    readonly zodError: ZodError;

    constructor(line: number, record: number, raw: string, zodError: ZodError) {
        super(
            `Invalid CSV row ${record} at line ${line} — ${validationDetail(zodError)}`,
            line,
            raw
        );

        this.name = 'RowValidationError';
        this.record = record;
        this.zodError = zodError;
    }
}

export class RowParseError extends CsvRowError {
    readonly code: string;
    override readonly cause: Error;

    constructor(line: number, raw: string, cause: Error & { code?: string }) {
        super(
            `Malformed CSV record at line ${line} — ${cause.message.replace(/ (?:on|at) line \d+$/, '')}`,
            line,
            raw
        );

        this.name = 'RowParseError';
        this.code = cause.code ?? 'CSV_RECORD_ERROR';
        this.cause = cause;
    }
}

export class MissingColumnsError extends Error {
    readonly missing: readonly string[];
    readonly columns: readonly string[];

    constructor(missing: readonly string[], columns: readonly string[]) {
        super(
            `CSV is missing ${missing.length === 1 ? 'column' : 'columns'} ${missing.join(', ')}` +
                ` — the file has ${columns.length ? columns.join(', ') : 'no columns'}`
        );

        this.name = 'MissingColumnsError';
        this.missing = missing;
        this.columns = columns;
    }
}

export class TooManyInvalidRowsError extends Error {
    readonly count: number;
    readonly maxErrors: number;
    readonly errors: readonly CsvRowError[];
    override readonly cause: CsvRowError;

    constructor(
        count: number,
        maxErrors: number,
        errors: readonly CsvRowError[],
        cause: CsvRowError
    ) {
        super(`Too many invalid CSV rows: ${count} exceeds maxErrors ${maxErrors}`);

        this.name = 'TooManyInvalidRowsError';
        this.count = count;
        this.maxErrors = maxErrors;
        this.errors = errors;
        this.cause = cause;
    }
}
