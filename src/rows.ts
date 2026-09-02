import type { ZodType, output } from 'zod';

import { RowValidationError, TooManyInvalidRowsError } from './errors';
import type { ResolvedOptions } from './types';

export interface ParsedEntry {
    record: unknown;
    raw: string;
    info: { lines: number; records: number };
}

export type RowOutcome<Out> =
    | { kind: 'row'; row: Out }
    | { kind: 'invalid'; error: RowValidationError }
    | { kind: 'fail'; error: Error };

export interface RowSink<Out> {
    readonly errors: readonly RowValidationError[];
    handle(entry: ParsedEntry): RowOutcome<Out>;
}

export interface RowLocation {
    line: number;
    raw: string;
}

const LF = 0x0a;
const CR = 0x0d;

export function lineBreaks(text: string): number {
    let count = 0;

    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);

        if (code === LF) count++;
        else if (code === CR && text.charCodeAt(i + 1) !== LF) count++;
    }

    return count;
}

function parserBreaks(text: string): number {
    let count = 0;

    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);

        if (code === LF || code === CR) count++;
    }

    return count;
}

function endsWithBreak(text: string): boolean {
    const last = text.charCodeAt(text.length - 1);

    return last === LF || last === CR;
}

function fieldBreaks(record: unknown): number {
    if (typeof record !== 'object' || record === null) return 0;

    let count = 0;

    for (const value of Object.values(record)) {
        if (typeof value === 'string') count += lineBreaks(value);
    }

    return count;
}

function trimRaw(raw: string, lines: number, trailing: number): string {
    let from = 0;

    for (let skipped = 0; skipped < lines && from < raw.length; from++) {
        const code = raw.charCodeAt(from);

        if (code === LF) skipped++;
        else if (code === CR) {
            skipped++;
            if (raw.charCodeAt(from + 1) === LF) from++;
        }
    }

    return raw.slice(from, raw.length - trailing);
}

export function createLineTracker(): (entry: ParsedEntry) => RowLocation {
    let cursor = -1;

    return entry => {
        const { raw } = entry;
        const trailing = endsWithBreak(raw) ? 1 : 0;

        if (cursor === -1) cursor = entry.info.lines - (parserBreaks(raw) - trailing);

        const total = lineBreaks(raw);
        const end = cursor + total - trailing;
        const line = Math.max(end - fieldBreaks(entry.record), cursor);
        const location = { line, raw: trimRaw(raw, line - cursor, trailing) };

        cursor += total;

        return location;
    };
}

function toError(thrown: unknown): Error {
    return thrown instanceof Error ? thrown : new Error(String(thrown));
}

export function createRowSink<S extends ZodType>(
    schema: S,
    options: ResolvedOptions
): RowSink<output<S>> {
    const { onInvalidRow, maxErrors, onRowError } = options;
    const errors: RowValidationError[] = [];
    const locate = createLineTracker();
    let invalid = 0;

    return {
        errors,

        handle(entry) {
            const { line, raw } = locate(entry);

            try {
                const result = schema.safeParse(entry.record);

                if (result.success) return { kind: 'row', row: result.data };

                const error = new RowValidationError(line, entry.info.records, raw, result.error);

                if (onInvalidRow === 'error') return { kind: 'fail', error };

                invalid++;
                if (onInvalidRow === 'collect') errors.push(error);
                onRowError?.(error);

                return invalid > maxErrors
                    ? {
                          kind: 'fail',
                          error: new TooManyInvalidRowsError(invalid, maxErrors, errors),
                      }
                    : { kind: 'invalid', error };
            } catch (thrown) {
                return { kind: 'fail', error: toError(thrown) };
            }
        },
    };
}
