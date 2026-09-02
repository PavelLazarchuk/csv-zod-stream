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

function lineEnd(text: string, from: number): number {
    for (let i = from; i < text.length; i++) {
        const code = text.charCodeAt(i);

        if (code === LF || code === CR) return i;
    }

    return text.length;
}

/**
 * Counts the comment and blank lines the parser stepped over on the way to this
 * record. They sit at the front of `raw`, and the record's own first line can be
 * neither — the parser would have stepped over that one too.
 *
 * Reading them off `raw` rather than off the parsed values keeps the position
 * right for fields the parser dropped, such as the extra columns of a ragged
 * record under `relaxColumnCount`.
 */
function leadingSkipped(raw: string, options: ResolvedOptions): number {
    const { comment, skipEmptyLines, trim } = options;
    let count = 0;
    let from = 0;

    while (from < raw.length) {
        const end = lineEnd(raw, from);
        const line = raw.slice(from, end);

        if (comment !== undefined && comment !== '' && line.startsWith(comment)) count++;
        else if (skipEmptyLines && (trim ? line.trim() : line) === '') count++;
        else break;

        from = end + (raw.charCodeAt(end) === CR && raw.charCodeAt(end + 1) === LF ? 2 : 1);
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

export function createLineTracker(options: ResolvedOptions): (entry: ParsedEntry) => RowLocation {
    let cursor = -1;

    return entry => {
        const { raw } = entry;
        const trailing = endsWithBreak(raw) ? 1 : 0;

        if (cursor === -1) cursor = entry.info.lines - (parserBreaks(raw) - trailing);

        const total = lineBreaks(raw);
        const end = cursor + total - trailing;
        const line = Math.min(cursor + leadingSkipped(raw, options), Math.max(end, cursor));
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
    const locate = createLineTracker(options);
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
