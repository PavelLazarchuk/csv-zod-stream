import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createCsvValidator } from '../src/index';
import type { CsvValidatorOptions } from '../src/index';
import { createCsvValidator as createWebCsvValidator } from '../src/web/index';
import { sliced } from './helpers';

interface Outcome {
    rows: unknown[];
    errors: [string, number, string][];
    failure: string | undefined;
}

async function onNode<S extends z.ZodType>(
    schema: S,
    text: string,
    options: CsvValidatorOptions,
    chunkSize: number
): Promise<Outcome> {
    const stream = createCsvValidator(schema, options);
    const rows: unknown[] = [];
    let failure: string | undefined;

    try {
        await pipeline(sliced(text, chunkSize), stream, async (source: AsyncIterable<unknown>) => {
            for await (const row of source) rows.push(row);
        });
    } catch (error) {
        failure = (error as Error).name;
    }

    return { rows, errors: stream.errors.map(e => [e.name, e.line, e.raw]), failure };
}

async function onWeb<S extends z.ZodType>(
    schema: S,
    text: string,
    options: CsvValidatorOptions,
    chunkSize: number
): Promise<Outcome> {
    const bytes = new TextEncoder().encode(text);
    const validator = createWebCsvValidator(schema, options);
    const rows: unknown[] = [];
    let failure: string | undefined;

    const source = new ReadableStream<Uint8Array>({
        start(controller) {
            for (let at = 0; at < bytes.length; at += chunkSize)
                controller.enqueue(bytes.slice(at, at + chunkSize));

            controller.close();
        },
    });

    try {
        for await (const row of source.pipeThrough(validator)) rows.push(row);
    } catch (error) {
        failure = (error as Error).name;
    }

    return { rows, errors: validator.errors.map(e => [e.name, e.line, e.raw]), failure };
}

const Person = z.object({
    name: z.string().min(1),
    age: z.coerce.number().int(),
    note: z.string().optional(),
});

const cases: [string, z.ZodType, string, CsvValidatorOptions][] = [
    ['plain rows', Person, 'name,age\na,1\nb,2\n', {}],
    ['a bad row under collect', Person, 'name,age\na,1\nb,x\n', { onInvalidRow: 'collect' }],
    ['a bad row under error', Person, 'name,age\na,1\nb,x\n', {}],
    [
        'blank cells mapped to undefined',
        Person,
        'name,age,note\na,1,\n',
        { emptyAs: 'undefined', onInvalidRow: 'collect' },
    ],
    ['blank cells mapped to null', Person, 'name,age,note\na,1,\n', { emptyAs: 'null' }],
    ['a missing column', Person, 'name,note\na,x\n', { onInvalidRow: 'collect' }],
    ['a sniffed delimiter', Person, 'name;age\na;1\nb;2\n', { delimiter: 'auto' }],
    [
        'a sniffed delimiter behind a misleading header',
        Person,
        'name, full;age\na;1\nb;2\n',
        { delimiter: 'auto', checkHeaders: false, onInvalidRow: 'collect' },
    ],
    [
        'a ragged record',
        Person,
        'name,age\na,1\nb,2,extra\nc,3\n',
        { skipRecordsWithError: true, onInvalidRow: 'collect' },
    ],
    [
        'a ragged record that stops the stream',
        Person,
        'name,age\na,1\nb,2,extra\nc,3\n',
        { skipRecordsWithError: true },
    ],
    [
        'maxErrors across both kinds of failure',
        Person,
        'name,age\na,x\nb,2,extra\nc,y\n',
        { skipRecordsWithError: true, onInvalidRow: 'collect', maxErrors: 2 },
    ],
    [
        'raw csv-parse options',
        Person,
        'skip me\nname,age\na,1\n',
        { parse: { from_line: 2 }, onInvalidRow: 'collect' },
    ],
];

describe('Node and web builds agree', () => {
    for (const [name, schema, text, options] of cases) {
        it(`on ${name}`, async () => {
            for (const chunkSize of [1, 5, 4096]) {
                const [node, web] = await Promise.all([
                    onNode(schema, text, options, chunkSize),
                    onWeb(schema, text, options, chunkSize),
                ]);

                const where = `${name} at chunk size ${chunkSize}`;

                // A failing Node stream is destroyed, which drops the rows still
                // in its buffer; the web build hands on whatever it enqueued
                // before the throw. Rows delivered before a failure are not part
                // of the contract, the failure and the collected errors are.
                if (node.failure ?? web.failure)
                    expect([web.failure, web.errors], where).toEqual([node.failure, node.errors]);
                else expect(web, where).toEqual(node);
            }
        });
    }
});
