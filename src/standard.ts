export interface ZodErrorLike extends Error {
    readonly issues: ReadonlyArray<{
        readonly path: ReadonlyArray<PropertyKey>;
        readonly message: string;
        readonly code?: string;
    }>;
}

export interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly '~standard': StandardSchemaV1.Props<Input, Output>;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace StandardSchemaV1 {
    export interface Props<Input = unknown, Output = Input> {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
        readonly types?: Types<Input, Output> | undefined;
    }

    export type Result<Output> = SuccessResult<Output> | FailureResult;

    export interface SuccessResult<Output> {
        readonly value: Output;
        readonly issues?: undefined;
    }

    export interface FailureResult {
        readonly issues: ReadonlyArray<Issue>;
    }

    export interface Issue {
        readonly message: string;
        readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
    }

    export interface PathSegment {
        readonly key: PropertyKey;
    }

    export interface Types<Input = unknown, Output = Input> {
        readonly input: Input;
        readonly output: Output;
    }

    export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
        Schema['~standard']['types']
    >['output'];
}

export interface CsvIssue {
    readonly path: readonly PropertyKey[];
    readonly message: string;
}

export type RowResult<Out> =
    | { success: true; data: Out }
    | { success: false; issues: readonly CsvIssue[]; zodError?: ZodErrorLike };

export type RowValidator<Out> = (record: unknown) => RowResult<Out> | Promise<RowResult<Out>>;

interface ZodLike<Out> {
    safeParse: (value: unknown) => ZodResult<Out>;
    safeParseAsync: (value: unknown) => Promise<ZodResult<Out>>;
}

type ZodResult<Out> = { success: true; data: Out } | { success: false; error: ZodErrorLike };

function isZodLike<Out>(schema: unknown): schema is ZodLike<Out> {
    const zod = schema as ZodLike<Out> | null;

    return typeof zod?.safeParse === 'function' && typeof zod.safeParseAsync === 'function';
}

function pathOf(issue: StandardSchemaV1.Issue): readonly PropertyKey[] {
    return (issue.path ?? []).map(segment => (typeof segment === 'object' ? segment.key : segment));
}

export function issuesOf(result: StandardSchemaV1.FailureResult): readonly CsvIssue[] {
    return result.issues.map(issue => ({ path: pathOf(issue), message: issue.message }));
}

function fromZod<Out>(result: ZodResult<Out>): RowResult<Out> {
    if (result.success) return result;

    return {
        success: false,
        issues: result.error.issues.map(issue => ({
            path: issue.path,
            message: issue.message,
        })),
        zodError: result.error,
    };
}

function fromStandard<Out>(result: StandardSchemaV1.Result<Out>): RowResult<Out> {
    return result.issues === undefined
        ? { success: true, data: result.value }
        : { success: false, issues: issuesOf(result) };
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
    return typeof (value as Promise<T>)?.then === 'function';
}

export function createValidator<Out>(schema: unknown, isAsync: boolean): RowValidator<Out> {
    if (isZodLike<Out>(schema)) {
        return isAsync
            ? record => schema.safeParseAsync(record).then(fromZod)
            : record => fromZod(schema.safeParse(record));
    }

    const standard = (schema as StandardSchemaV1<unknown, Out>)['~standard'];

    return record => {
        const result = standard.validate(record);

        return isPromise(result) ? result.then(fromStandard) : fromStandard(result);
    };
}

export function assertSchema(schema: unknown): void {
    if (isZodLike(schema)) return;

    const standard = (schema as StandardSchemaV1 | null)?.['~standard'];

    if (typeof standard?.validate === 'function') return;

    throw new TypeError(
        'schema must be a Zod schema or any other Standard Schema (Zod 3.24+, zod/mini, Valibot, ArkType)'
    );
}
