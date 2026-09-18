import type { CsvIssue, ZodErrorLike } from './standard';

export abstract class CsvRowError extends Error {
    readonly line: number;
    readonly raw: string;

    constructor(message: string, line: number, raw: string) {
        super(message);

        this.line = line;
        this.raw = raw;
    }
}

function validationDetail(issues: readonly CsvIssue[]): string {
    const [first] = issues;
    const where = first?.path.map(String).join('.');
    const detail = first ? `${where ? `${where}: ` : ''}${first.message}` : 'invalid';
    const more = issues.length - 1;

    return detail + (more > 0 ? ` (+${more} more issue${more > 1 ? 's' : ''})` : '');
}

export class RowValidationError extends CsvRowError {
    readonly record: number;
    readonly issues: readonly CsvIssue[];
    readonly zodError: ZodErrorLike | undefined;

    constructor(
        line: number,
        record: number,
        raw: string,
        issues: readonly CsvIssue[],
        zodError?: ZodErrorLike
    ) {
        super(`Invalid CSV row ${record} at line ${line} — ${validationDetail(issues)}`, line, raw);

        this.name = 'RowValidationError';
        this.record = record;
        this.issues = issues;
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

export type ColumnSuggestions = Readonly<Record<string, string>>;

function didYouMean(suggestions: ColumnSuggestions): string {
    const pairs = Object.entries(suggestions);

    if (!pairs.length) return '';

    return ` — did you mean ${pairs.map(([name, match]) => `"${match}" for "${name}"`).join(', ')}?`;
}

export class MissingColumnsError extends Error {
    readonly missing: readonly string[];
    readonly columns: readonly string[];
    readonly suggestions: ColumnSuggestions;

    constructor(
        missing: readonly string[],
        columns: readonly string[],
        suggestions: ColumnSuggestions = {}
    ) {
        super(
            `CSV is missing ${missing.length === 1 ? 'column' : 'columns'} ${missing.join(', ')}` +
                ` — the file has ${columns.length ? columns.join(', ') : 'no columns'}` +
                didYouMean(suggestions)
        );

        this.name = 'MissingColumnsError';
        this.missing = missing;
        this.columns = columns;
        this.suggestions = suggestions;
    }
}

export class UnknownColumnsError extends Error {
    readonly unknown: readonly string[];
    readonly columns: readonly string[];
    readonly suggestions: ColumnSuggestions;

    constructor(
        unknown: readonly string[],
        columns: readonly string[],
        suggestions: ColumnSuggestions = {}
    ) {
        super(
            `CSV has unknown ${unknown.length === 1 ? 'column' : 'columns'} ${unknown.join(', ')}` +
                ` — the schema does not define ${unknown.length === 1 ? 'it' : 'them'}` +
                didYouMean(suggestions)
        );

        this.name = 'UnknownColumnsError';
        this.unknown = unknown;
        this.columns = columns;
        this.suggestions = suggestions;
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
