import { parse } from 'csv-parse';
import type { CsvError, Options } from 'csv-parse';
import { describe, expect, it } from 'vitest';

interface Entry {
    record: Record<string, string>;
    raw: string;
    info: { lines: number; records: number; columns: { name: string }[] };
}

interface Skipped {
    error: CsvError;
    raw: string | undefined;
}

function run(text: string, options: Options = {}) {
    return new Promise<{ entries: Entry[]; skipped: Skipped[] }>((resolve, reject) => {
        const skipped: Skipped[] = [];
        const parser = parse({
            columns: true,
            info: true,
            raw: true,
            on_skip: (error, raw) => {
                if (error) skipped.push({ error, raw });

                return undefined;
            },
            ...options,
        });
        const entries: Entry[] = [];

        parser.on('readable', () => {
            let entry: Entry | null;

            while ((entry = parser.read() as Entry | null) !== null) entries.push(entry);
        });
        parser.on('error', reject);
        parser.on('end', () => resolve({ entries, skipped }));

        parser.write(text);
        parser.end();
    });
}

describe('csv-parse contract', () => {
    it('puts the skipped comment and blank lines at the front of raw', async () => {
        const { entries } = await run('name,age\n\n# note\na,1\nb,2\n', {
            comment: '#',
            skip_empty_lines: true,
        });

        expect(entries.map(entry => entry.raw)).toEqual(['\n# note\na,1\n', 'b,2\n']);
    });

    it('keeps the CR but drops the LF of a CRLF terminator', async () => {
        const { entries } = await run('name,age\r\na,1\r\n');

        expect(entries[0]!.raw).toBe('a,1\r');
    });

    it('counts a CRLF terminator once and a CRLF inside a field twice', async () => {
        const plain = await run('name,age\r\na,1\r\n');
        const quoted = await run('name,note\r\na,"x\r\ny"\r\n');

        expect(plain.entries[0]!.info.lines).toBe(2);
        expect(quoted.entries[0]!.info.lines).toBe(4);
    });

    it('numbers records from one and reports the columns it resolved', async () => {
        const { entries } = await run('name,age\na,1\nb,2\n');

        expect(entries.map(entry => entry.info.records)).toEqual([1, 2]);
        expect(entries[0]!.info.columns).toEqual([{ name: 'name' }, { name: 'age' }]);
    });

    it('reports the columns given through options as well', async () => {
        const { entries } = await run('a,1\n', { columns: ['name', 'age'] });

        expect(entries[0]!.info.columns).toEqual([{ name: 'name' }, { name: 'age' }]);
    });

    it('hands on_skip the raw record, its line and the records seen so far', async () => {
        const { entries, skipped } = await run('name,age\na,1\nb,2,extra\nc,3\n', {
            skip_records_with_error: true,
        });

        expect(entries.map(entry => entry.info.records)).toEqual([1, 2]);
        expect(skipped).toHaveLength(1);
        expect(skipped[0]!.raw).toBe('b,2,extra\n');
        expect(skipped[0]!.error.code).toBe('CSV_RECORD_INCONSISTENT_COLUMNS');
        expect(skipped[0]!.error.lines).toBe(3);
        expect(skipped[0]!.error.records).toBe(1);
    });

    it('puts skipped comment and blank lines in front of a skipped record too', async () => {
        const { skipped } = await run('name,age\na,1\n\n# note\nb,2,extra\nc,3\n', {
            comment: '#',
            skip_empty_lines: true,
            skip_records_with_error: true,
        });

        expect(skipped[0]!.raw).toBe('\n# note\nb,2,extra\n');
        expect(skipped[0]!.error.lines).toBe(5);
    });
});
