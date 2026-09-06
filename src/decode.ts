import type { ResolvedOptions } from './types';

export interface Decoder {
    push(chunk: Uint8Array): Uint8Array;
    flush(): Uint8Array;
}

export function createDecoder(options: ResolvedOptions): Decoder | undefined {
    const { encoding } = options;

    if (encoding === undefined) return undefined;

    const decoder = new TextDecoder(encoding, { ignoreBOM: !options.bom });
    const encoder = new TextEncoder();

    return {
        push: chunk => encoder.encode(decoder.decode(chunk, { stream: true })),
        flush: () => encoder.encode(decoder.decode()),
    };
}
