import { Transform } from 'node:stream';

import { assertBatchSize } from './batch-size';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface BatchTransform<T> extends Transform {
    on(event: 'data', listener: (batch: T[]) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;

    once(event: 'data', listener: (batch: T[]) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Groups validated rows into arrays of `size`, the shape a bulk insert wants.
 * The last batch is whatever is left over.
 *
 * ```ts
 * await pipeline(source, createCsvValidator(User), batched(500), async batches => {
 *     for await (const users of batches) await db.insertMany(users);
 * });
 * ```
 */
export function batched<T>(size: number): BatchTransform<T> {
    assertBatchSize(size);

    let batch: T[] = [];

    return new Transform({
        objectMode: true,

        transform(row: T, _encoding, callback) {
            batch.push(row);

            if (batch.length < size) return callback();

            const full = batch;
            batch = [];

            callback(null, full);
        },

        flush(callback) {
            if (!batch.length) return callback();

            const rest = batch;
            batch = [];

            callback(null, rest);
        },
    }) as BatchTransform<T>;
}
