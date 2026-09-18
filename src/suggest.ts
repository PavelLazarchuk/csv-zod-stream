const MAX_LENGTH = 64;

function distance(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    let beforePrevious: number[] = [];
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

    for (let i = 0; i < a.length; i++) {
        const row = [i + 1];

        for (let j = 0; j < b.length; j++) {
            const substitute = (previous[j] as number) + (a[i] === b[j] ? 0 : 1);
            const insert = (row[j] as number) + 1;
            const remove = (previous[j + 1] as number) + 1;

            let best = Math.min(substitute, insert, remove);

            if (i > 0 && j > 0 && a[i] === b[j - 1] && a[i - 1] === b[j])
                best = Math.min(best, (beforePrevious[j - 1] as number) + 1);

            row.push(best);
        }

        beforePrevious = previous;
        previous = row;
    }

    return previous[b.length] as number;
}

function tolerance(name: string): number {
    return name.length < 4 ? 1 : Math.max(1, Math.floor(name.length / 3));
}

export function nearest(name: string, candidates: readonly string[]): string | undefined {
    if (name.length > MAX_LENGTH) return undefined;

    const target = name.toLowerCase();
    const budget = tolerance(target);

    let best: string | undefined;
    let bestDistance = budget + 1;

    for (const candidate of candidates) {
        if (candidate.length > MAX_LENGTH) continue;

        const found = distance(target, candidate.toLowerCase());

        if (found < bestDistance) {
            best = candidate;
            bestDistance = found;
        }
    }

    return best;
}

export function suggestions(
    names: readonly string[],
    candidates: readonly string[]
): Record<string, string> {
    const pairs: [string, string][] = [];

    for (const name of names) {
        const match = nearest(name, candidates);

        if (match !== undefined) pairs.push([name, match]);
    }

    return Object.fromEntries(pairs);
}
