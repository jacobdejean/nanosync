declare module "nanosync" {
  /**
   * Core Types
   */
  export type FieldType =
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "time"
    | "datetime"
    | "json"
    | "array"
    | "object"
    | "custom";

  export type FieldValue = string | number | boolean | null | object;

  export type Field = {
    key: string;
    type: FieldType;
  };

  export type MappedField = {
    sourceField: Field;
    targetField: Field;
  };

  export type QueryResult<T = FieldValue> = Promise<T>;
  export type MutationResult<T = FieldValue> = Promise<T>;

  export type Integration = {
    name: string;
    description: string;
    resolveQuery: <T extends FieldValue = FieldValue>(
      fieldKey: string,
    ) => QueryResult<T>;
    resolveMutation: <T extends FieldValue = FieldValue>(
      fieldKey: string,
      value: T,
    ) => MutationResult<T>;
  };

  export type ProcessOptions = {
    readonly fields: Array<MappedField>;
    readonly sourceIntegration: Integration;
    readonly targetIntegration: Integration;
  };

  export type Process = {
    readonly options: ProcessOptions;
    readonly schema: import("graphql").GraphQLSchema;
  };

  /**
   * Functions
   */
  export function findQueryFieldName(
    fields: Array<MappedField>,
    mutationFieldName: string,
  ): string | undefined;

  export function findMutationFieldName(
    fields: Array<MappedField>,
    queryFieldName: string,
  ): string | undefined;

  export function FieldValue(value: any): FieldValue;

  export function createProcess(options: ProcessOptions): Process | null;

  export function createSchema(
    fields: Array<MappedField>,
    sourceIntegration: Integration,
    targetIntegration: Integration,
  ): import("graphql").GraphQLSchema;

  export function createQuerySchema(
    fields: Array<MappedField>,
    resolver: Integration["resolveQuery"],
  ): import("graphql").GraphQLObjectType;

  export function createMutationSchema(
    fields: Array<MappedField>,
    resolver: Integration["resolveMutation"],
  ): import("graphql").GraphQLObjectType;

  export function createQueryString(
    schema: import("graphql").GraphQLSchema,
  ): string;

  export function createMutationString(
    schema: import("graphql").GraphQLSchema,
    fieldMappings: Array<MappedField>,
    queryResults: Record<string, any>,
  ): string;

  export function resolveSource(process: Process): Promise<any>;

  export function resolveTarget(
    process: Process,
    queryResults: Record<string, any>,
  ): Promise<any | null>;

  export function validateProcess(process: Process): boolean;

  export function sync(process: Process): Promise<any | null>;
}
