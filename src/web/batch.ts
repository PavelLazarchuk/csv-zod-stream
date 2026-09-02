import { assertBatchSize } from '../batch-size';

/**
 * Groups validated rows into arrays of `size`, the shape a bulk insert wants.
 * The last batch is whatever is left over.
 *
 * ```ts
 * const batches = response.body.pipeThrough(createCsvValidator(User)).pipeThrough(batched(500));
 * for await (const users of batches) await db.insertMany(users);
 * ```
 */
export function batched<T>(size: number): TransformStream<T, T[]> {
    assertBatchSize(size);

    let batch: T[] = [];

    return new TransformStream<T, T[]>({
        transform(row, controller) {
            batch.push(row);

            if (batch.length < size) return;

            controller.enqueue(batch);
            batch = [];
        },

        flush(controller) {
            if (batch.length) controller.enqueue(batch);
        },
    });
}
