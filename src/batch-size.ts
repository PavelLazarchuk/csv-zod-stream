export function assertBatchSize(size: number): void {
    if (!Number.isInteger(size) || size < 1)
        throw new RangeError(`batched() needs a positive integer size, got ${String(size)}`);
}
