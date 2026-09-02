import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { RowValidationError, createCsvValidator } from '../src/index';
import { createCsvValidator as createWebCsvValidator } from '../src/web/index';
import type { CsvValidatorOptions } from '../src/index';

const fixture = (name: string) => join(import.meta.dirname, 'fixtures', name);

const Employee = z.object({
    id: z.coerce.number().int().positive(),
    name: z.string().min(1),
    email: z.email(),
    department: z.enum(['Engineering', 'Design', 'Support']),
    salary: z.coerce.number().int(),
    notes: z.string(),
});

type Employee = z.infer<typeof Employee>;

async function fromFile(name: string, options?: CsvValidatorOptions) {
    const stream = createCsvValidator(Employee, options);
    const rows: Employee[] = [];

    await pipeline(
        createReadStream(fixture(name)),
        stream,
        async (source: AsyncIterable<Employee>) => {
            for await (const row of source) rows.push(row);
        }
    );

    return { rows, stream };
}

describe('real files on disk', () => {
    it('reads a CSV with a BOM, quoted commas, doubled quotes and a multiline field', async () => {
        const { rows } = await fromFile('people.csv');

        expect(rows).toHaveLength(5);
        expect(rows[0]).toEqual({
            id: 1,
            name: 'Ash, Linden',
            email: 'ash@example.com',
            department: 'Engineering',
            salary: 98000,
            notes: 'Joined 2019.\nPrefers async reviews.',
        });
        expect(rows[2]!.name).toBe("O'Brien, Sam".replace("'", '"'));
        expect(rows[2]!.notes).toBe('Said "ship it" once.');
        expect(rows[4]!.notes).toBe('Tab\tinside a quoted field');
    });

    it('reads the TSV twin of that file', async () => {
        const { rows } = await fromFile('people.tsv', { delimiter: '\t' });

        expect(rows.map(row => row.id)).toEqual([1, 2, 3]);
        expect(rows[0]!.notes).toBe('Joined 2019.\nPrefers async reviews.');
    });

    it('sniffs a semicolon CRLF file with a blank line in it', async () => {
        const { rows } = await fromFile('people-semicolon.csv', { delimiter: 'auto' });

        expect(rows.map(row => row.name)).toEqual(['Ash Linden', 'Nour Haddad']);
    });

    it('collects every bad row of a messy file and keeps the good ones', async () => {
        const { rows, stream } = await fromFile('messy.csv', { onInvalidRow: 'collect' });

        expect(rows.map(row => row.id)).toEqual([1, 4]);
        expect(stream.errors.map(error => ({ line: error.line, record: error.record }))).toEqual([
            { line: 3, record: 2 },
            { line: 4, record: 3 },
            { line: 7, record: 5 },
        ]);
        expect(stream.errors[0]!.zodError.issues[0]!.path).toEqual(['email']);
        expect(stream.errors[2]!.raw).toContain('blank name');
    });

    it('stops on the first bad row by default', async () => {
        await expect(fromFile('messy.csv')).rejects.toBeInstanceOf(RowValidationError);
    });

    it('feeds the web build from the same file', async () => {
        const source = Readable.toWeb(
            createReadStream(fixture('people.csv'))
        ) as ReadableStream<Uint8Array>;
        const rows: Employee[] = [];

        for await (const row of source.pipeThrough(createWebCsvValidator(Employee))) rows.push(row);

        expect(rows).toHaveLength(5);
        expect(rows[0]!.notes).toBe('Joined 2019.\nPrefers async reviews.');
    });
});

describe('a large file on disk', () => {
    let dir: string;
    let path: string;
    const ROWS = 250_000;

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), 'csv-zod-stream-'));
        path = join(dir, 'employees.csv');

        const lines = ['id,name,email,department,salary,notes'];
        const departments = ['Engineering', 'Design', 'Support'];

        for (let i = 1; i <= ROWS; i++) {
            const department = departments[i % 3];
            const notes = i % 5000 === 0 ? '"a note\nover two lines"' : 'ok';

            lines.push(`${i},person ${i},p${i}@example.com,${department},${50000 + i},${notes}`);
        }

        lines[199_999] = '200000,broken,not-an-email,Design,50000,ok';

        await writeFile(path, `${lines.join('\n')}\n`);
    }, 60_000);

    afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('streams the whole file', async () => {
        let count = 0;
        let multiline = 0;

        await pipeline(
            createReadStream(path),
            createCsvValidator(Employee, { onInvalidRow: 'skip' }),
            async (rows: AsyncIterable<Employee>) => {
                for await (const row of rows) {
                    count++;
                    if (row.notes.includes('\n')) multiline++;
                }
            }
        );

        expect(count).toBe(ROWS - 1);
        expect(multiline).toBe(Math.floor(ROWS / 5000));
    }, 60_000);

    it('reports the physical line of a bad row 200 000 records in', async () => {
        const failing = pipeline(
            createReadStream(path),
            createCsvValidator(Employee),
            async (rows: AsyncIterable<Employee>) => {
                for await (const _row of rows);
            }
        );

        // 39 records before it carry a two-line note, so the record index and
        // the line number have drifted apart by then.
        await expect(failing).rejects.toMatchObject({
            record: 199_999,
            line: 199_999 + 1 + 39,
        });
    }, 60_000);
});
