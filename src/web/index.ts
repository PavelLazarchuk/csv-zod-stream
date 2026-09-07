import { parse } from 'csv-parse/stream';
import type { ZodType, output } from 'zod';

import {
    SNIFF_LIMIT,
    SNIFF_LINES,
    byteOf,
    concat,
    createLineScanner,
    detectDelimiter,
    sampleOf,
} from '../detect';
import type { CsvRowError } from '../errors';
import { parserOptions } from '../parser';
import { createRowSink, createSkipQueue, isPending } from '../rows';
import type { ParsedEntry, RowOutcome, SkipQueue } from '../rows';
import { resolveOptions } from '../types';
import type { CsvRow, CsvValidatorOptions, MetaOptions, ResolvedOptions } from '../types';
import { decodeStream } from './decode';

export type {
    CsvRow,
    CsvValidatorOptions,
    EmptyCellValue,
    HeaderCase,
    HeaderMapper,
    InvalidRowStrategy,
    MetaOptions,
    ResolvedOptions,
} from '../types';
export {
    CsvRowError,
    MissingColumnsError,
    RowParseError,
    RowValidationError,
    TooManyInvalidRowsError,
} from '../errors';
export { detectDelimiter } from '../detect';
export { rejectsCsv } from '../rejects';
export type { RejectsCsvOptions } from '../rejects';
export { batched } from './batch';
export { parseCsv } from './one-shot';
export type { ParseCsvResult } from './one-shot';

export interface CsvValidatorStream<Out> extends ReadableWritablePair<Out, Uint8Array> {
    readonly errors: readonly CsvRowError[];
    readonly droppedErrors: number;
}

interface Source {
    delimiter: string;
    stream: ReadableStream<Uint8Array>;
}

/**
 * Reads just enough of the stream to sample a few lines, then hands back the
 * delimiter together with a stream that replays what was read.
 */
async function sniff(
    readable: ReadableStream<Uint8Array>,
    options: ResolvedOptions
): Promise<Source> {
    const reader = readable.getReader();
    const quote = byteOf(options.quote, 0x22);
    const scanner = createLineScanner({
        quote,
        escape: byteOf(options.escape, quote),
        comment: byteOf(options.comment),
        lines: SNIFF_LINES,
    });
    const head: Uint8Array[] = [];
    let size = 0;
    let drained = false;

    while (size < SNIFF_LIMIT) {
        const { done, value } = await reader.read();

        if (done) {
            drained = true;
            break;
        }

        head.push(value);
        size += value.length;

        if (scanner.push(value)) break;
    }

    const buffered = concat(head);

    if (drained || !scanner.ranges.length) scanner.finish(buffered.length);

    return {
        delimiter: detectDelimiter(
            sampleOf(buffered, scanner.ranges),
            options.quote,
            options.escape
        ),
        stream: new ReadableStream<Uint8Array>({
            start(controller) {
                if (buffered.length) controller.enqueue(buffered);
                if (drained) controller.close();
            },
            async pull(controller) {
                const { done, value } = await reader.read();

                if (done) controller.close();
                else controller.enqueue(value);
            },
            cancel: reason => reader.cancel(reason),
        }),
    };
}

function validator<S extends ZodType, Out>(schema: S, options: ResolvedOptions, skips: SkipQueue) {
    const sink = createRowSink<S, Out>(schema, options);

    const deliver = (
        outcome: RowOutcome<Out>,
        controller: TransformStreamDefaultController<Out>
    ) => {
        if (outcome.kind === 'fail') throw outcome.error;
        if (outcome.kind === 'row') controller.enqueue(outcome.row);
    };

    const stream = new TransformStream<ParsedEntry, Out>({
        transform(entry, controller) {
            for (const skipped of skips.take(entry.info.records))
                deliver(sink.skip(skipped), controller);

            const outcome = sink.handle(entry);

            if (isPending(outcome)) return outcome.then(settled => deliver(settled, controller));

            deliver(outcome, controller);
        },
        flush(controller) {
            for (const skipped of skips.drain()) deliver(sink.skip(skipped), controller);
        },
    });

    return { sink, stream };
}

/**
 * Web Streams counterpart of the Node export, for Deno, Bun and edge runtimes.
 *
 * ```ts
 * const rows = response.body.pipeThrough(createCsvValidator(User));
 * for await (const user of rows) await save(user);
 * ```
 *
 * Backpressure comes from `pipeThrough` itself: nothing is pulled out of the
 * parser until the consumer asks for the next row.
 */
export function createCsvValidator<S extends ZodType>(
    schema: S,
    options: MetaOptions
): CsvValidatorStream<CsvRow<output<S>>>;
export function createCsvValidator<S extends ZodType>(
    schema: S,
    options?: CsvValidatorOptions
): CsvValidatorStream<output<S>>;
export function createCsvValidator<S extends ZodType>(
    schema: S,
    options: CsvValidatorOptions = {}
): CsvValidatorStream<output<S>> {
    const resolved = resolveOptions(options);
    const skips = createSkipQueue();
    const { sink, stream: validate } = validator<S, output<S>>(schema, resolved, skips);
    const input = new TransformStream<Uint8Array, Uint8Array>();
    const decode = decodeStream(resolved);

    void (async () => {
        try {
            const bytes = decode ? input.readable.pipeThrough(decode) : input.readable;
            const source =
                resolved.delimiter === 'auto'
                    ? await sniff(bytes, resolved)
                    : { delimiter: resolved.delimiter, stream: bytes };

            const parser = parse(
                parserOptions(resolved, source.delimiter, skips.add)
            ) as unknown as ReadableWritablePair<ParsedEntry, Uint8Array>;

            await source.stream.pipeThrough(parser).pipeTo(validate.writable);
        } catch (error) {
            await validate.writable.abort(error).catch(() => {});
        }
    })();

    return {
        writable: input.writable,
        readable: validate.readable,
        get errors() {
            return sink.errors;
        },
        get droppedErrors() {
            return sink.droppedErrors;
        },
    };
}
