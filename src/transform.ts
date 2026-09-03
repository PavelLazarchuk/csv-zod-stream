import { Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';

import { parse } from 'csv-parse';
import type { Parser } from 'csv-parse';
import type { ZodType, output } from 'zod';

import {
    SNIFF_LIMIT,
    SNIFF_LINES,
    byteOf,
    concat,
    createLineScanner,
    detectDelimiter,
    sampleOf,
} from './detect';
import type { LineScanner } from './detect';
import type { CsvRowError } from './errors';
import { parserOptions } from './parser';
import { createRowSink, createSkipQueue } from './rows';
import type { ParsedEntry, RowOutcome, RowSink, SkipQueue, SkippedEntry } from './rows';
import { resolveOptions } from './types';
import type { CsvValidatorOptions, ResolvedOptions } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ZodCsvTransform<S extends ZodType> {
    on(event: 'invalid-row', listener: (error: CsvRowError) => void): this;
    on(event: 'data', listener: (row: output<S>) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;

    once(event: 'invalid-row', listener: (error: CsvRowError) => void): this;
    once(event: 'data', listener: (row: output<S>) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;

    emit(event: 'invalid-row', error: CsvRowError): boolean;
    emit(event: string | symbol, ...args: any[]): boolean;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Byte stream in, validated rows out.
 *
 * Rows are pulled out of `csv-parse` only while the readable side keeps
 * accepting them. Stop reading and the pull loop stops, `csv-parse` fills up,
 * its writes start returning `false`, and the upstream `_transform` callback is
 * withheld — so the pressure reaches the file handle instead of the heap.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- merged with the event typings above
export class ZodCsvTransform<S extends ZodType> extends Transform {
    readonly #options: ResolvedOptions;
    readonly #sink: RowSink<output<S>>;
    readonly #skips: SkipQueue;

    #parser: Parser | undefined;
    #sniff: Uint8Array[] | undefined;
    #sniffed = 0;
    #scanner: LineScanner | undefined;

    #writeCb: TransformCallback | undefined;
    #flushCb: TransformCallback | undefined;

    #parserReady = true;
    #parserEnded = false;
    #failed = false;

    constructor(schema: S, options: CsvValidatorOptions = {}) {
        super({ writableObjectMode: false, readableObjectMode: true });

        this.#options = resolveOptions(options);
        this.#sink = createRowSink(schema, this.#options);
        this.#skips = createSkipQueue();

        if (this.#options.delimiter !== 'auto') this.#open(this.#options.delimiter);
        else {
            const quote = byteOf(this.#options.quote, 0x22);

            this.#sniff = [];
            this.#scanner = createLineScanner({
                quote,
                escape: byteOf(this.#options.escape, quote),
                comment: byteOf(this.#options.comment),
                lines: SNIFF_LINES,
            });
        }
    }

    get errors(): readonly CsvRowError[] {
        return this.#sink.errors;
    }

    #open(delimiter: string): Parser {
        const parser = parse(parserOptions(this.#options, delimiter, this.#skips.add));

        parser.on('readable', this.#pump);
        parser.on('drain', () => {
            this.#parserReady = true;
            this.#pump();
        });
        parser.on('end', () => {
            this.#parserEnded = true;
            this.#pump();
        });
        parser.on('error', error => this.#abort(error));

        this.#parser = parser;

        return parser;
    }

    #openSniffed(buffered: Uint8Array, atEof: boolean): Parser {
        const scanner = this.#scanner as LineScanner;

        if (atEof || !scanner.ranges.length) scanner.finish(buffered.length);

        const sample = sampleOf(buffered, scanner.ranges);

        this.#sniff = undefined;
        this.#scanner = undefined;

        return this.#open(detectDelimiter(sample, this.#options.quote, this.#options.escape));
    }

    override _transform(chunk: Uint8Array, _encoding: BufferEncoding, callback: TransformCallback) {
        let parser = this.#parser;
        let payload = chunk;

        if (!parser) {
            const sniff = this.#sniff as Uint8Array[];
            const enough = (this.#scanner as LineScanner).push(chunk);

            sniff.push(chunk);
            this.#sniffed += chunk.length;

            if (!enough && this.#sniffed < SNIFF_LIMIT) return callback();

            payload = concat(sniff);
            parser = this.#openSniffed(payload, false);
        }

        this.#writeCb = callback;
        this.#parserReady = parser.write(payload);
        this.#pump();
    }

    override _flush(callback: TransformCallback) {
        this.#flushCb = callback;

        let parser = this.#parser;

        if (!parser) {
            const buffered = concat(this.#sniff ?? []);

            parser = this.#openSniffed(buffered, true);
            if (buffered.length) parser.write(buffered);
        }

        parser.end();
        this.#pump();
    }

    override _read(size: number) {
        super._read(size);

        queueMicrotask(this.#pump);
    }

    override _destroy(error: Error | null, callback: (error: Error | null) => void) {
        this.#writeCb = undefined;
        this.#flushCb = undefined;
        this.#sniff = undefined;
        this.#parser?.destroy();

        callback(error);
    }

    #pump = () => {
        const parser = this.#parser;
        if (!parser || this.#failed || this.destroyed) return;

        while (!this.destroyed && this.#hasRoom()) {
            const entry = parser.read() as ParsedEntry | null;
            if (entry === null) break;

            if (!this.#deliverSkips(this.#skips.take(entry.info.records))) return;
            if (!this.#deliver(this.#sink.handle(entry))) return;
        }

        if (this.#parserEnded && !this.#deliverSkips(this.#skips.drain())) return;
        if (this.#parserReady && this.#hasRoom()) this.#release();

        this.#finish();
    };

    #deliver(outcome: RowOutcome<output<S>>): boolean {
        if (outcome.kind === 'fail') {
            this.#abort(outcome.error);

            return false;
        }

        if (outcome.kind === 'invalid') this.emit('invalid-row', outcome.error);
        else if (outcome.row === null) {
            this.#abort(
                new TypeError(
                    'A schema that outputs null cannot be streamed: null ends a Node object-mode stream. Have the schema output undefined, or another placeholder, instead.'
                )
            );

            return false;
        } else this.push(outcome.row);

        return true;
    }

    #deliverSkips(entries: readonly SkippedEntry[]): boolean {
        for (const entry of entries) if (!this.#deliver(this.#sink.skip(entry))) return false;

        return true;
    }

    #hasRoom() {
        return this.readableLength < this.readableHighWaterMark;
    }

    #release() {
        const callback = this.#writeCb;

        this.#writeCb = undefined;
        callback?.();
    }

    #finish() {
        if (!this.#parserEnded || !this.#flushCb) return;

        const callback = this.#flushCb;

        this.#flushCb = undefined;
        callback();
    }

    #abort(error: Error) {
        if (this.#failed) return;

        this.#failed = true;
        this.destroy(error);
    }
}

/**
 * Creates a `Transform` that parses CSV/TSV bytes and emits rows that passed
 * `schema`, in object mode.
 *
 * ```ts
 * await pipeline(createReadStream('big.csv'), createCsvValidator(User), async rows => {
 *     for await (const user of rows) await save(user);
 * });
 * ```
 */
export function createCsvValidator<S extends ZodType>(
    schema: S,
    options?: CsvValidatorOptions
): ZodCsvTransform<S> {
    return new ZodCsvTransform(schema, options);
}
