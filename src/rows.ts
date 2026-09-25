import {
    type CsvRowError,
    MissingColumnsError,
    RowParseError,
    RowValidationError,
    TooManyInvalidRowsError,
    UnknownColumnsError,
} from './errors';
import type { SkipHandler } from './parser';
import { assertSchema, createValidator } from './standard';
import type { RowResult, StandardSchemaV1 } from './standard';
import { suggestions } from './suggest';
import type { CsvRow, CsvStats, ResolvedOptions } from './types';

export type ParsedColumns = readonly (string | { name: string })[];

export interface ParsedEntry {
    record: unknown;
    raw: string;
    info: { lines: number; records: number; bytes?: number; columns?: ParsedColumns };
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

export interface RowSink<Out> {
    readonly errors: readonly CsvRowError[];
    readonly droppedErrors: number;
    readonly stats: CsvStats;
    headers(columns: readonly string[], origin: 'file' | 'options'): void;
    handle(entry: ParsedEntry): PendingOutcome<Out>;
    skip(entry: SkippedEntry): RowOutcome<Out>;
    end(): void;
}

export function isPending<Out>(outcome: PendingOutcome<Out>): outcome is Promise<RowOutcome<Out>> {
    return typeof (outcome as Promise<RowOutcome<Out>>).then === 'function';
}

function isPendingResult<Out>(
    result: RowResult<Out> | Promise<RowResult<Out>>
): result is Promise<RowResult<Out>> {
    return typeof (result as Promise<RowResult<Out>>).then === 'function';
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

function shapeOf(schema: unknown): Record<string, unknown> | undefined {
    try {
        const { shape, entries } = schema as {
            shape?: Record<string, unknown>;
            entries?: Record<string, unknown>;
        };
        const fields = shape ?? entries;

        return fields && typeof fields === 'object' ? fields : undefined;
    } catch {
        return undefined;
    }
}

function optional(field: unknown): boolean | undefined {
    try {
        const zod = field as { safeParse?: (value: unknown) => { success: boolean } };

        if (typeof zod.safeParse === 'function') return zod.safeParse(undefined).success;

        const standard = (field as StandardSchemaV1)['~standard'];

        if (typeof standard?.validate !== 'function') return undefined;

        const result = standard.validate(undefined);

        if (typeof (result as Promise<unknown>).then === 'function') {
            void (result as Promise<unknown>).catch(() => undefined);

            return undefined;
        }

        return (result as StandardSchemaV1.Result<unknown>).issues === undefined;
    } catch {
        return undefined;
    }
}

function requiredColumns(shape: Record<string, unknown>): string[] | undefined {
    const required: string[] = [];

    for (const [key, field] of Object.entries(shape)) {
        const accepts = optional(field);

        if (accepts === undefined) return undefined;
        if (!accepts) required.push(key);
    }

    return required;
}

function createHeaderCheck<S>(
    schema: S,
    options: ResolvedOptions
): ((columns: readonly string[] | undefined) => Error | undefined) | undefined {
    const { checkHeaders, unknownColumns } = options;

    if (checkHeaders === false) return undefined;

    const shape = checkHeaders === true ? shapeOf(schema) : undefined;
    const listed = checkHeaders === true ? undefined : checkHeaders;

    const known = shape ? Object.keys(shape) : listed;
    const required = shape ? requiredColumns(shape) : listed;

    const wantsUnknown = unknownColumns !== 'ignore' && known !== undefined;

    if (!required?.length && !wantsUnknown) return undefined;

    const fields = known as string[];
    let checked = false;

    return columns => {
        if (checked || !columns) return undefined;
        checked = true;

        const unmatched = columns.filter(name => !fields.includes(name));
        const missing = required?.filter(name => !columns.includes(name)) ?? [];

        if (missing.length)
            return new MissingColumnsError(missing, columns, suggestions(missing, unmatched));

        if (!wantsUnknown || !unmatched.length) return undefined;

        const error = new UnknownColumnsError(
            unmatched,
            columns,
            suggestions(
                unmatched,
                fields.filter(name => !columns.includes(name))
            )
        );

        if (unknownColumns === 'error') return error;

        console.warn(error.message);

        return undefined;
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

function createErrorLog(keep: number): ErrorLog {
    const limit = Math.floor(keep);
    const ring: CsvRowError[] = [];
    let cursor = 0;
    let dropped = 0;

    return {
        get kept() {
            return [...ring.slice(cursor), ...ring.slice(0, cursor)];
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

export function createRowSink<S extends StandardSchemaV1, Out = StandardSchemaV1.InferOutput<S>>(
    schema: S,
    options: ResolvedOptions
): RowSink<Out> {
    assertSchema(schema);

    const {
        onInvalidRow,
        maxErrors,
        keepErrors,
        onRowError,
        onProgress,
        progressEveryRecords,
        progressEveryBytes,
        async: isAsync,
        withMeta,
    } = options;
    const log = createErrorLog(keepErrors);
    const locate = createLineTracker(options);
    const checkHeader = createHeaderCheck(schema, options);
    const validate = createValidator<Out>(schema, isAsync);
    const emptyCells = createEmptyCells(options);
    const collects = onInvalidRow === 'collect';

    let bytes = 0;
    let records = 0;
    let valid = 0;
    let invalid = 0;

    let lastRecords = 0;
    let lastBytes = 0;
    let lastColumns: readonly string[] | undefined;
    let sawInput = false;

    const snapshot = (): CsvStats => ({
        bytes,
        records,
        valid,
        invalid,
        dropped: collects ? log.dropped : 0,
    });

    function report(final: boolean): void {
        if (!onProgress) return;

        const byRecords = records - lastRecords >= progressEveryRecords;
        const byBytes = progressEveryBytes !== undefined && bytes - lastBytes >= progressEveryBytes;

        if (!final && !byRecords && !byBytes) return;
        if (final && records === lastRecords && bytes === lastBytes) return;

        lastRecords = records;
        lastBytes = bytes;

        onProgress(snapshot());
    }

    function track(info: { records: number; bytes?: number }): void {
        sawInput = true;
        records = Math.max(records, info.records);
        if (info.bytes !== undefined) bytes = Math.max(bytes, info.bytes);
    }

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
        result: RowResult<Out>,
        line: number,
        record: number,
        raw: string
    ): RowOutcome<Out> {
        if (!result.success)
            return register(
                new RowValidationError(line, record, raw, result.issues, result.zodError)
            );

        valid++;

        const row = withMeta
            ? ({ row: result.data, line, record } satisfies CsvRow<Out>)
            : result.data;

        return { kind: 'row', row: row as Out };
    }

    return {
        get errors() {
            return collects ? log.kept : NO_ERRORS;
        },

        get droppedErrors() {
            return collects ? log.dropped : 0;
        },

        get stats() {
            return snapshot();
        },

        headers(columns, origin) {
            lastColumns = columns;
            if (origin === 'file') sawInput = true;
        },

        end() {
            const wrongHeader = sawInput ? checkHeader?.(lastColumns) : undefined;

            if (wrongHeader) throw wrongHeader;

            report(true);
        },

        handle(entry) {
            try {
                const wrongHeader = checkHeader?.(columnNames(entry.info.columns) ?? lastColumns);

                if (wrongHeader) return { kind: 'fail', error: wrongHeader };

                const { line, raw } = locate(entry);
                const record = entry.info.records;

                emptyCells?.(entry.record);
                track(entry.info);

                const result = validate(entry.record);

                if (!isPendingResult(result)) {
                    const outcome = judge(result, line, record, raw);

                    report(false);

                    return outcome;
                }

                return result.then(
                    settled => {
                        const outcome = judge(settled, line, record, raw);

                        report(false);

                        return outcome;
                    },
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

                track(entry.info);

                const outcome = register(new RowParseError(line, raw, entry.cause));

                report(false);

                return outcome;
            } catch (thrown) {
                return { kind: 'fail', error: toError(thrown) };
            }
        },
    };
}
