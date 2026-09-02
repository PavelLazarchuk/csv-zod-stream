import { Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';

import { parse } from 'csv-parse';
import type { Parser } from 'csv-parse';
import type { ZodType, output } from 'zod';

import { SNIFF_LIMIT, byteOf, concat, createLineScanner, detectDelimiter } from './detect';
import type { LineScanner } from './detect';
import type { RowValidationError } from './errors';
import { parserOptions } from './parser';
import { createRowSink } from './rows';
import type { ParsedEntry, RowSink } from './rows';
import { resolveOptions } from './types';
import type { CsvValidatorOptions, ResolvedOptions } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ZodCsvTransform<S extends ZodType> {
    on(event: 'invalid-row', listener: (error: RowValidationError) => void): this;
    on(event: 'data', listener: (row: output<S>) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;

    once(event: 'invalid-row', listener: (error: RowValidationError) => void): this;
    once(event: 'data', listener: (row: output<S>) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;

    emit(event: 'invalid-row', error: RowValidationError): boolean;
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

        if (this.#options.delimiter !== 'auto') this.#open(this.#options.delimiter);
        else {
            this.#sniff = [];
            this.#scanner = createLineScanner(
                byteOf(this.#options.quote, 0x22),
                byteOf(this.#options.comment)
            );
        }
    }

    get errors(): readonly RowValidationError[] {
        return this.#sink.errors;
    }

    #open(delimiter: string): Parser {
        const parser = parse(parserOptions(this.#options, delimiter));

        parser.on('readable', this.#pump);
        parser.on('drain', () => {
            this.#parserReady = true;
            this.#pump();
        });
        parser.on('end', () => {
            this.#parserEnded = true;
            this.#finish();
        });
        parser.on('error', error => this.#abort(error));

        this.#parser = parser;

        return parser;
    }

    #openSniffed(buffered: Uint8Array, end: number): Parser {
        const start = (this.#scanner as LineScanner).start;
        const sample = buffered.subarray(start, end === -1 ? buffered.length : end);

        this.#sniff = undefined;
        this.#scanner = undefined;

        return this.#open(detectDelimiter(sample, this.#options.quote));
    }

    override _transform(chunk: Uint8Array, _encoding: BufferEncoding, callback: TransformCallback) {
        let parser = this.#parser;
        let payload = chunk;

        if (!parser) {
            const sniff = this.#sniff as Uint8Array[];
            const end = (this.#scanner as LineScanner).push(chunk);

            sniff.push(chunk);
            this.#sniffed += chunk.length;

            if (end === -1 && this.#sniffed < SNIFF_LIMIT) return callback();

            payload = concat(sniff);
            parser = this.#openSniffed(payload, end);
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

            parser = this.#openSniffed(buffered, -1);
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
        this.#parser?.destroy();

        callback(error);
    }

    #pump = () => {
        const parser = this.#parser;
        if (!parser || this.#failed || this.destroyed) return;

        while (!this.destroyed && this.#hasRoom()) {
            const entry = parser.read() as ParsedEntry | null;
            if (entry === null) break;

            const outcome = this.#sink.handle(entry);

            if (outcome.kind === 'fail') return this.#abort(outcome.error);
            if (outcome.kind === 'invalid') this.emit('invalid-row', outcome.error);
            else this.push(outcome.row);
        }

        if (this.#parserReady && this.#hasRoom()) this.#release();
        this.#finish();
    };

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
