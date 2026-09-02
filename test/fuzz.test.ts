import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createCsvValidator } from '../src/index';
import type { CsvRowError, CsvValidatorOptions } from '../src/index';
import { createCsvValidator as createWebCsvValidator } from '../src/web/index';
import { sliced } from './helpers';

const Rejecting = z.unknown().refine(() => false, 'rejected');

type Ending = '\n' | '\r\n' | '\r';

interface Document {
    text: string;
    expected: [number, string][];
    options: CsvValidatorOptions;
    chunkSize: number;
}

function mulberry32(seed: number) {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;

        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

const WORDS = ['ash', 'nour', 'lee', 'kim', 'ada', '', '  pad  ', 'a b', "it's"];

function makeDocument(seed: number): Document {
    const random = mulberry32(seed);
    const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)] as T;
    const chance = (probability: number) => random() < probability;

    const ending = pick<Ending>(['\n', '\r\n', '\r']);
    const delimiter = pick([',', ';', '\t']);
    const comment = chance(0.5) ? '#' : undefined;
    const columns = 2 + Math.floor(random() * 3);
    const records = 1 + Math.floor(random() * 6);

    const field = () => {
        const word = pick(WORDS);

        if (chance(0.25)) return `"${word}${ending}${pick(WORDS)}"`;
        if (chance(0.2)) return `"${word}""${pick(WORDS)}"`;
        if (chance(0.2)) return `"${word}${delimiter}${pick(WORDS)}"`;

        return word;
    };

    const lines: string[] = [];
    const expected: [number, string][] = [];
    let line = 1;

    const addNoise = () => {
        while (chance(0.35)) {
            if (comment !== undefined && chance(0.5)) lines.push(`${comment} noise${lines.length}`);
            else lines.push('');

            line++;
        }
    };

    const header = Array.from({ length: columns }, (_, index) => `col${index}`).join(delimiter);

    addNoise();
    lines.push(header);
    line += header.split(ending).length;

    for (let index = 0; index < records; index++) {
        addNoise();

        const record = Array.from({ length: columns }, field).join(delimiter);

        expected.push([line, record]);
        lines.push(record);
        line += record.split(ending).length;
    }

    const trailing = chance(0.8);
    const bom = chance(0.2) ? '﻿' : '';

    return {
        text: bom + lines.join(ending) + (trailing ? ending : ''),
        expected,
        options: {
            onInvalidRow: 'collect',
            delimiter: chance(0.5) ? 'auto' : delimiter,
            ...(comment === undefined ? {} : { comment }),
        },
        chunkSize: 1 + Math.floor(random() * 24),
    };
}

async function nodePositions(document: Document): Promise<[number, string][]> {
    const stream = createCsvValidator(Rejecting, document.options);

    await pipeline(
        sliced(document.text, document.chunkSize),
        stream,
        async (rows: AsyncIterable<unknown>) => {
            for await (const _row of rows);
        }
    );

    return stream.errors.map(error => [error.line, error.raw]);
}

async function webPositions(document: Document): Promise<[number, string][]> {
    const bytes = new TextEncoder().encode(document.text);
    const validator = createWebCsvValidator(Rejecting, document.options);
    const source = new ReadableStream<Uint8Array>({
        start(controller) {
            for (let at = 0; at < bytes.length; at += document.chunkSize)
                controller.enqueue(bytes.slice(at, at + document.chunkSize));

            controller.close();
        },
    });

    for await (const _row of source.pipeThrough(validator));

    return (validator.errors as readonly CsvRowError[]).map(error => [error.line, error.raw]);
}

describe('generated documents', () => {
    const documents = Array.from({ length: 250 }, (_, seed) => makeDocument(seed + 1));

    it('reports the first line and the exact text of every record', async () => {
        for (const [index, document] of documents.entries()) {
            const positions = await nodePositions(document);

            expect(positions, `seed ${index + 1}: ${JSON.stringify(document.text)}`).toEqual(
                document.expected
            );
        }
    });

    it('agrees between the Node and the web build', async () => {
        for (const [index, document] of documents.entries()) {
            const [node, web] = await Promise.all([
                nodePositions(document),
                webPositions(document),
            ]);

            expect(web, `seed ${index + 1}: ${JSON.stringify(document.text)}`).toEqual(node);
        }
    });
});
