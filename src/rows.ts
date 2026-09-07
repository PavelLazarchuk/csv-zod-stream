import type { ZodError, ZodType, output } from 'zod';

import {
    type CsvRowError,
    MissingColumnsError,
    RowParseError,
    RowValidationError,
    TooManyInvalidRowsError,
} from './errors';
import type { SkipHandler } from './parser';
import type { CsvRow, ResolvedOptions } from './types';

export type ParsedColumns = readonly (string | { name: string })[];

export interface ParsedEntry {
    record: unknown;
    raw: string;
    info: { lines: number; records: number; columns?: ParsedColumns };
}

export interface SkippedEntry {
    raw: string;
    info: { lines: number; records: number };
    cause: Error & { code?: string };
}

export type RowOutcome<Out> =
    | { kind: 'row'; row: Out }
    | { kind: 'invalid'; error: CsvRowError }
    | { kind: 'fail'; error: Error };

export type PendingOutcome<Out> = RowOutcome<Out> | Promise<RowOutcome<Out>>;

type ParseResult<Out> = { success: true; data: Out } | { success: false; error: ZodError };

export interface RowSink<Out> {
    readonly errors: readonly CsvRowError[];
    readonly droppedErrors: number;
    handle(entry: ParsedEntry): PendingOutcome<Out>;
    skip(entry: SkippedEntry): RowOutcome<Out>;
}

export function isPending<Out>(outcome: PendingOutcome<Out>): outcome is Promise<RowOutcome<Out>> {
    return typeof (outcome as Promise<RowOutcome<Out>>).then === 'function';
}

export interface SkipQueue {
    readonly add: SkipHandler;
    take(before: number): SkippedEntry[];
    drain(): SkippedEntry[];
}

export interface RowLocation {
    line: number;
    raw: string;
}

interface Located {
    raw: string;
    info: { lines: number };
}

const LF = 0x0a;
const CR = 0x0d;

const NO_ERRORS: readonly CsvRowError[] = [];

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

export function createLineTracker(options: ResolvedOptions): (entry: Located) => RowLocation {
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

export function createSkipQueue(): SkipQueue {
    const pending: SkippedEntry[] = [];

    return {
        add(error, raw) {
            if (!error) return undefined;

            const context = error as unknown as {
                raw?: string;
                lines?: number;
                records?: number;
            };

            pending.push({
                raw: raw ?? context.raw ?? '',
                info: { lines: context.lines ?? 0, records: context.records ?? 0 },
                cause: error,
            });

            return undefined;
        },

        take(before) {
            let count = 0;
            while (count < pending.length && (pending[count] as SkippedEntry).info.records < before)
                count++;

            return pending.splice(0, count);
        },

        drain() {
            return pending.splice(0, pending.length);
        },
    };
}

function columnNames(columns: ParsedColumns | undefined): string[] | undefined {
    return columns?.map(column => (typeof column === 'string' ? column : column.name));
}

function requiredColumns(schema: ZodType): string[] | undefined {
    try {
        const { shape } = schema as { shape?: Record<string, ZodType> };

        if (!shape || typeof shape !== 'object') return undefined;

        return Object.entries(shape)
            .filter(([, field]) => !field.safeParse(undefined).success)
            .map(([key]) => key);
    } catch {
        return undefined;
    }
}

function createHeaderCheck<S extends ZodType>(
    schema: S,
    options: ResolvedOptions
): ((entry: ParsedEntry) => MissingColumnsError | undefined) | undefined {
    const { checkHeaders } = options;

    if (checkHeaders === false) return undefined;

    const required = checkHeaders === true ? requiredColumns(schema) : checkHeaders;

    if (!required?.length) return undefined;

    let checked = false;

    return entry => {
        if (checked) return undefined;
        checked = true;

        const columns = columnNames(entry.info.columns);

        if (!columns) return undefined;

        const missing = required.filter(name => !columns.includes(name));

        return missing.length ? new MissingColumnsError(missing, columns) : undefined;
    };
}

function createEmptyCells(options: ResolvedOptions): ((record: unknown) => void) | undefined {
    if (options.emptyAs === 'keep') return undefined;

    const replacement = options.emptyAs === 'null' ? null : undefined;

    return record => {
        if (typeof record !== 'object' || record === null) return;

        const cells = record as Record<string, unknown>;

        for (const key of Object.keys(cells)) if (cells[key] === '') cells[key] = replacement;
    };
}

interface ErrorLog {
    readonly kept: readonly CsvRowError[];
    readonly dropped: number;
    add(error: CsvRowError): void;
}

function createErrorLog(limit: number): ErrorLog {
    const ring: CsvRowError[] = [];
    let cursor = 0;
    let dropped = 0;

    return {
        get kept() {
            return cursor ? [...ring.slice(cursor), ...ring.slice(0, cursor)] : ring;
        },

        get dropped() {
            return dropped;
        },

        add(error) {
            if (limit < 1) {
                dropped++;

                return;
            }

            if (ring.length < limit) {
                ring.push(error);

                return;
            }

            ring[cursor] = error;
            cursor = (cursor + 1) % limit;
            dropped++;
        },
    };
}

function toError(thrown: unknown): Error {
    return thrown instanceof Error ? thrown : new Error(String(thrown));
}

export function createRowSink<S extends ZodType, Out = output<S>>(
    schema: S,
    options: ResolvedOptions
): RowSink<Out> {
    const { onInvalidRow, maxErrors, keepErrors, onRowError, async: isAsync, withMeta } = options;
    const log = createErrorLog(keepErrors);
    const locate = createLineTracker(options);
    const checkHeader = createHeaderCheck(schema, options);
    const emptyCells = createEmptyCells(options);
    let invalid = 0;

    function register(error: CsvRowError): RowOutcome<Out> {
        if (onInvalidRow === 'error') return { kind: 'fail', error };

        invalid++;
        log.add(error);
        onRowError?.(error);

        return invalid > maxErrors
            ? {
                  kind: 'fail',
                  error: new TooManyInvalidRowsError(invalid, maxErrors, log.kept, error),
              }
            : { kind: 'invalid', error };
    }

    function judge(
        result: ParseResult<output<S>>,
        line: number,
        record: number,
        raw: string
    ): RowOutcome<Out> {
        if (!result.success)
            return register(new RowValidationError(line, record, raw, result.error));

        const row = withMeta
            ? ({ row: result.data, line, record } satisfies CsvRow<output<S>>)
            : result.data;

        return { kind: 'row', row: row as Out };
    }

    return {
        get errors() {
            return onInvalidRow === 'collect' ? log.kept : NO_ERRORS;
        },

        get droppedErrors() {
            return onInvalidRow === 'collect' ? log.dropped : 0;
        },

        handle(entry) {
            try {
                const missing = checkHeader?.(entry);

                if (missing) return { kind: 'fail', error: missing };

                const { line, raw } = locate(entry);
                const record = entry.info.records;

                emptyCells?.(entry.record);

                if (!isAsync) return judge(schema.safeParse(entry.record), line, record, raw);

                return schema.safeParseAsync(entry.record).then(
                    result => judge(result, line, record, raw),
                    (thrown: unknown): RowOutcome<Out> => ({
                        kind: 'fail',
                        error: toError(thrown),
                    })
                );
            } catch (thrown) {
                return { kind: 'fail', error: toError(thrown) };
            }
        },

        skip(entry) {
            try {
                const { line, raw } = locate(entry);

                return register(new RowParseError(line, raw, entry.cause));
            } catch (thrown) {
                return { kind: 'fail', error: toError(thrown) };
            }
        },
    };
}
