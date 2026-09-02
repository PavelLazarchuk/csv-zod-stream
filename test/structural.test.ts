import { pipeline } from 'node:stream/promises';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { RowParseError, TooManyInvalidRowsError, createCsvValidator, parseCsv } from '../src/index';
import type { CsvRowError, CsvValidatorOptions } from '../src/index';
import { sliced } from './helpers';

const Row = z.object({ name: z.string(), age: z.coerce.number() });

const RAGGED = 'name,age\na,1\nb,2,extra\nc,3\n';

function run(text: string, options: CsvValidatorOptions, chunkSize = 4) {
    const stream = createCsvValidator(Row, options);
    const rows: z.infer<typeof Row>[] = [];
    const invalid: CsvRowError[] = [];

    stream.on('invalid-row', error => invalid.push(error));

    const done = pipeline(
        sliced(text, chunkSize),
        stream,
        async (source: AsyncIterable<z.infer<typeof Row>>) => {
            for await (const row of source) rows.push(row);
        }
    );

    return { stream, rows, invalid, done };
}

describe('structural errors', () => {
    it('destroys the stream by default', async () => {
        const { done } = run(RAGGED, { onInvalidRow: 'collect' });

        await expect(done).rejects.toThrow(/columns length/i);
    });

    it('reports a ragged record through the invalid-row channel instead', async () => {
        const { done, rows, invalid } = run(RAGGED, {
            skipRecordsWithError: true,
            onInvalidRow: 'skip',
        });

        await done;

        expect(rows).toEqual([
            { name: 'a', age: 1 },
            { name: 'c', age: 3 },
        ]);
        expect(invalid).toHaveLength(1);
        expect(invalid[0]).toBeInstanceOf(RowParseError);
        expect(invalid[0]!.line).toBe(3);
        expect(invalid[0]!.raw).toBe('b,2,extra');
        expect((invalid[0] as RowParseError).code).toBe('CSV_RECORD_INCONSISTENT_COLUMNS');
    });

    it('carries the parser error as the cause and drops its line suffix', async () => {
        const { done, invalid } = run(RAGGED, {
            skipRecordsWithError: true,
            onInvalidRow: 'skip',
        });

        await done;

        const error = invalid[0] as RowParseError;

        expect(error.message).toBe(
            'Malformed CSV record at line 3 — Invalid Record Length: columns length is 2, got 3'
        );
        expect(error.cause.message).toMatch(/on line 3$/);
    });

    it('collects it next to the validation errors', async () => {
        const { done, stream } = run('name,age\na,x\nb,2,extra\nc,3\n', {
            skipRecordsWithError: true,
            onInvalidRow: 'collect',
        });

        await done;

        expect(stream.errors.map(error => [error.name, error.line])).toEqual([
            ['RowValidationError', 2],
            ['RowParseError', 3],
        ]);
    });

    it('calls onRowError for it too', async () => {
        const onRowError = vi.fn();

        await run(RAGGED, { skipRecordsWithError: true, onInvalidRow: 'skip', onRowError }).done;

        expect(onRowError).toHaveBeenCalledOnce();
        expect(onRowError.mock.calls[0]![0]).toBeInstanceOf(RowParseError);
    });

    it("still stops the stream under 'error'", async () => {
        const { done } = run(RAGGED, { skipRecordsWithError: true });

        await expect(done).rejects.toBeInstanceOf(RowParseError);
    });

    it('keeps the line numbers of the rows behind it right', async () => {
        const { done, invalid } = run('name,age\n\n# note\nb,2,extra\nc,x\nd,y\n', {
            skipRecordsWithError: true,
            onInvalidRow: 'skip',
            comment: '#',
        });

        await done;

        expect(invalid.map(error => [error.name, error.line, error.raw])).toEqual([
            ['RowParseError', 4, 'b,2,extra'],
            ['RowValidationError', 5, 'c,x'],
            ['RowValidationError', 6, 'd,y'],
        ]);
    });

    it('holds a record spanning several lines in the right place', async () => {
        const { done, invalid } = run('name,age\na,"x\ny"\nb,2,extra\nc,z\n', {
            skipRecordsWithError: true,
            onInvalidRow: 'skip',
        });

        await done;

        expect(invalid.map(error => [error.line, error.raw])).toEqual([
            [2, 'a,"x\ny"'],
            [4, 'b,2,extra'],
            [5, 'c,z'],
        ]);
    });

    it('counts against maxErrors alongside the invalid rows', async () => {
        const { done } = run('name,age\na,x\nb,2,extra\nc,y\n', {
            skipRecordsWithError: true,
            onInvalidRow: 'collect',
            maxErrors: 2,
        });

        const failure = (await done.catch((error: Error) => error)) as TooManyInvalidRowsError;

        expect(failure).toBeInstanceOf(TooManyInvalidRowsError);
        expect(failure.count).toBe(3);
        expect(failure.maxErrors).toBe(2);
        expect(failure.cause.line).toBe(4);
        expect(failure.errors.map(error => error.name)).toEqual([
            'RowValidationError',
            'RowParseError',
            'RowValidationError',
        ]);
    });

    it('names the offending row even when nothing is collected', async () => {
        const { done } = run('name,age\na,x\nb,y\n', { onInvalidRow: 'skip', maxErrors: 1 });

        const failure = (await done.catch((error: Error) => error)) as TooManyInvalidRowsError;

        expect(failure.errors).toEqual([]);
        expect(failure.cause.line).toBe(3);
        expect(failure.cause.raw).toBe('b,y');
    });

    it('survives a run of bad records at the end of a file', async () => {
        const { rows, errors } = await parseCsv('name,age\na,1\nb,2,x\nc,3,y\n', Row, {
            skipRecordsWithError: true,
        });

        expect(rows).toEqual([{ name: 'a', age: 1 }]);
        expect(errors.map(error => [error.name, error.line])).toEqual([
            ['RowParseError', 3],
            ['RowParseError', 4],
        ]);
    });
});
