import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseCsv, rejectsCsv } from '../src/index';
import { rejectsCsv as webRejectsCsv } from '../src/web/index';

const Person = z.object({ name: z.string().min(1), age: z.coerce.number().int() });

const file = 'name,age\nAda,36\n,nope\nGrace,45\n';

async function rejects(text: string, options?: Parameters<typeof parseCsv>[2]) {
    const { errors } = await parseCsv(text, Person, { ...options, onInvalidRow: 'collect' });

    return errors;
}

describe('rejectsCsv', () => {
    it('renders a header and one line per rejected row', async () => {
        const csv = rejectsCsv(await rejects(file));

        expect(csv.split('\n')[0]).toBe('line,record,error,code,field,message,raw');
        expect(csv.split('\n')).toHaveLength(3);
        expect(csv).toContain('RowValidationError');
        expect(csv).toContain('3,2,RowValidationError,,');
    });

    it('names every field the row failed on', async () => {
        const [error] = await rejects(file);
        const [, row] = rejectsCsv([error!]).split('\n');

        expect(row).toContain('name; age');
    });

    it('quotes cells holding the delimiter, a quote or a line break', async () => {
        const errors = await rejects('name,age\n"multi\nline",nope\n');
        const csv = rejectsCsv(errors);

        expect(csv).toContain('"""multi\nline"",nope"');
    });

    it('carries a structural error with its parse code', async () => {
        const errors = await rejects('name,age\nAda,36,extra\n', { skipRecordsWithError: true });
        const csv = rejectsCsv(errors);

        expect(csv).toContain('RowParseError');
        expect(csv).toContain('CSV_RECORD_INCONSISTENT_COLUMNS');
    });

    it('writes only a header when nothing was rejected', async () => {
        expect(rejectsCsv(await rejects('name,age\nAda,36\n'))).toBe(
            'line,record,error,code,field,message,raw\n'
        );
    });

    it('writes nothing at all when the header is off and nothing was rejected', () => {
        expect(rejectsCsv([], { header: false })).toBe('');
    });

    it('takes a delimiter, an eol and a BOM', async () => {
        const csv = rejectsCsv(await rejects(file), { delimiter: ';', eol: '\r\n', bom: true });

        expect(csv.startsWith('﻿line;record;error;code;field;message;raw\r\n')).toBe(true);
    });

    it('is exported from the web build as well', () => {
        expect(webRejectsCsv([], { header: false })).toBe('');
    });
});
