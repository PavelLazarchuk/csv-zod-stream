import { createDecoder } from '../decode';
import type { ResolvedOptions } from '../types';

export function decodeStream(
    options: ResolvedOptions
): TransformStream<Uint8Array, Uint8Array> | undefined {
    const decoder = createDecoder(options);

    if (!decoder) return undefined;

    return new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            const decoded = decoder.push(chunk);

            if (decoded.length) controller.enqueue(decoded);
        },

        flush(controller) {
            const tail = decoder.flush();

            if (tail.length) controller.enqueue(tail);
        },
    });
}
