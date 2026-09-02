import { parse } from 'csv-parse/stream';
import type { ZodType, output } from 'zod';

import { SNIFF_LIMIT, byteOf, concat, createLineScanner, detectDelimiter } from '../detect';
import type { RowValidationError } from '../errors';
import { parserOptions } from '../parser';
import { createRowSink } from '../rows';
import type { ParsedEntry } from '../rows';
import { resolveOptions } from '../types';
import type { CsvValidatorOptions, ResolvedOptions } from '../types';

export type { CsvValidatorOptions, InvalidRowStrategy } from '../types';
export { RowValidationError, TooManyInvalidRowsError } from '../errors';
export { detectDelimiter } from '../detect';

export interface CsvValidatorStream<Out> extends ReadableWritablePair<Out, Uint8Array> {
    readonly errors: readonly RowValidationError[];
}

interface Source {
    delimiter: string;
    stream: ReadableStream<Uint8Array>;
}

/**
 * Reads just enough of the stream to see one line, then hands back the
 * delimiter together with a stream that replays what was read.
 */
async function sniff(
    readable: ReadableStream<Uint8Array>,
    options: ResolvedOptions
): Promise<Source> {
    const reader = readable.getReader();
    const scanner = createLineScanner(byteOf(options.quote, 0x22), byteOf(options.comment));
    const head: Uint8Array[] = [];
    let size = 0;
    let end = -1;
    let drained = false;

    while (size < SNIFF_LIMIT) {
        const { done, value } = await reader.read();

        if (done) {
            drained = true;
            break;
        }

        head.push(value);
        size += value.length;
        end = scanner.push(value);

        if (end !== -1) break;
    }

    const buffered = concat(head);
    const sample = buffered.subarray(scanner.start, end === -1 ? buffered.length : end);

    return {
        delimiter: detectDelimiter(sample, options.quote),
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

function validator<S extends ZodType>(schema: S, options: ResolvedOptions) {
    const sink = createRowSink(schema, options);

    const stream = new TransformStream<ParsedEntry, output<S>>({
        transform(entry, controller) {
            const outcome = sink.handle(entry);

            if (outcome.kind === 'fail') throw outcome.error;
            if (outcome.kind === 'row') controller.enqueue(outcome.row);
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
    options: CsvValidatorOptions = {}
): CsvValidatorStream<output<S>> {
    const resolved = resolveOptions(options);
    const { sink, stream: validate } = validator(schema, resolved);
    const input = new TransformStream<Uint8Array, Uint8Array>();

    void (async () => {
        try {
            const source =
                resolved.delimiter === 'auto'
                    ? await sniff(input.readable, resolved)
                    : { delimiter: resolved.delimiter, stream: input.readable };

            const parser = parse(
                parserOptions(resolved, source.delimiter)
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
    };
}
