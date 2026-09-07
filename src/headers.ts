import type { CsvValidatorOptions, HeaderCase, HeaderMapper } from './types';

const BOUNDARY = /(\p{Ll}|\p{N})(\p{Lu})/gu;
const SEPARATOR = /[^\p{L}\p{N}]+/u;

function words(header: string): string[] {
    return header.replace(BOUNDARY, '$1 $2').split(SEPARATOR).filter(Boolean);
}

const CASES: Record<HeaderCase, (header: string) => string> = {
    trim: header => header.trim(),

    lower: header => header.trim().toLowerCase(),

    snake: header => {
        const parts = words(header);

        return parts.length ? parts.join('_').toLowerCase() : header.trim();
    },

    camel: header => {
        const parts = words(header).map(word => word.toLowerCase());

        if (!parts.length) return header.trim();

        return parts
            .map((word, index) => (index ? word.charAt(0).toUpperCase() + word.slice(1) : word))
            .join('');
    },
};

export function assertHeaderCase(value: string): asserts value is HeaderCase {
    if (!Object.hasOwn(CASES, value))
        throw new RangeError(
            `Unknown normalizeHeaders ${JSON.stringify(value)} — expected ${Object.keys(CASES).join(', ')} or a function`
        );
}

export function createHeaderMapper(options: CsvValidatorOptions): HeaderMapper | undefined {
    const { normalizeHeaders, columnAliases } = options;

    if (normalizeHeaders === undefined && columnAliases === undefined) return undefined;

    let normalize: HeaderMapper | undefined;

    if (typeof normalizeHeaders === 'function') normalize = normalizeHeaders;
    else if (normalizeHeaders !== undefined) {
        assertHeaderCase(normalizeHeaders);

        const preset = CASES[normalizeHeaders];

        normalize = header => preset(header);
    }

    return (header, index) => {
        const normalized = normalize ? normalize(header, index) : header;

        if (!columnAliases) return normalized;

        return columnAliases[header] ?? columnAliases[normalized] ?? normalized;
    };
}
