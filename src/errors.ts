import type { ZodError } from 'zod';

export class RowValidationError extends Error {
    readonly line: number;
    readonly record: number;
    readonly raw: string;
    readonly zodError: ZodError;

    constructor(line: number, record: number, raw: string, zodError: ZodError) {
        const [first] = zodError.issues;
        const where = first?.path.map(String).join('.');
        const detail = first ? `${where ? `${where}: ` : ''}${first.message}` : 'invalid';
        const more = zodError.issues.length - 1;

        super(
            `Invalid CSV row ${record} at line ${line} — ${detail}` +
                (more > 0 ? ` (+${more} more issue${more > 1 ? 's' : ''})` : '')
        );

        this.name = 'RowValidationError';
        this.line = line;
        this.record = record;
        this.raw = raw;
        this.zodError = zodError;
    }
}

export class TooManyInvalidRowsError extends Error {
    readonly count: number;
    readonly errors: readonly RowValidationError[];

    constructor(count: number, maxErrors: number, errors: readonly RowValidationError[]) {
        super(`Too many invalid CSV rows: ${count} exceeds maxErrors ${maxErrors}`);

        this.name = 'TooManyInvalidRowsError';
        this.count = count;
        this.errors = errors;
    }
}
