/**
     ____  ____ _____  ____  _______  ______  _____ __________
    / __ \/ __ `/ __ \/ __ \/ ___/ / / / __ \/ ___// ___/ ___/
   / / / / /_/ / / / / /_/ (__  ) /_/ / / / / /___/ /__/ /__
  /_/ /_/\__,_/_/ /_/\____/____/\__, /_/ /_/\___(_)___/\___/
                               /____/

  Nanosync is a simple and unopinionated library for syncing
  field data between any two integrations.

  It accomplished through a simple, standardized API for
  building integrations. Essentially, all an integration needs
  to implement is a way to resolve a query and a mutation
  given a set of fields.
*/

import {
  graphql,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";

import invariant from "tiny-invariant";

/**
    The core of nanosync is a `Process` object which represents
    an effort to sync data between two integrations. With given
    field mapping and a source and target integration, this
    library.

    Process holds it's initial options and a generated sync schema.
    This sync schema contains all of the necessary information to
    generate the queries and mutations. It's up to the integration
    if it actually sends graphql to it's API (ideally if its supported)
    or if it uses the mapped fields only. Regardless, the graphql schema
    is the source of truth once the process is created.
*/
export type Process = {
  readonly options: ProcessOptions;
  readonly schema: GraphQLSchema;
};

/**
    ProcessOptions are used to initialize a new Process object. The options
    are `immutable` (this is still js) so we expect that a bi-directional sync
    will require two processes, and that updating a process means replacing it
*/
export type ProcessOptions = {
  readonly fields: Array<MappedField>;
  readonly sourceIntegration: Integration;
  readonly targetIntegration: Integration;
};

/**
    FieldType covers every basic column type that you would find in a service
    like airtable, postgres, or google sheets, etc. so it should cover a lot of
    semantic ground. there should be an escape hatch type for custom types
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

/**
    FieldValue represents the possible underlying js types for any FieldType
*/
export type FieldValue = string | number | boolean | null | object;

/**
  Field respresents a field in a source or target integration
  mapped to a standardized nanosync type
*/
export type Field = {
  key: string;
  type: FieldType;
};

/**
    MappedField represents two associated fields in a source and target integration.
    sourceField will overwrite targetField
*/
export type MappedField = {
  sourceField: Field;
  targetField: Field;
};

export type QueryResult<T = FieldValue> = Promise<T>;
export type MutationResult<T = FieldValue> = Promise<T>;

/**
    Integration stores basic information about a service as well as the
    necessary functions to resolve a sync process.
*/
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

/**
    findQueryFieldName finds the source field key given a target field key
*/
export const findQueryFieldName = (
  fields: Array<MappedField>,
  mutationFieldName: string,
) =>
  fields.find((f) => mutationFieldName === f.targetField.key)?.sourceField.key;

/**
    findMutationFieldName finds the target field key given a source field key
*/
export const findMutationFieldName = (
  fields: Array<MappedField>,
  queryFieldName: string,
) => fields.find((f) => queryFieldName === f.sourceField.key)?.targetField.key;

/**
    This cast is just used for mocking
*/
export const FieldValue = (value: any) => String(value) as FieldValue;

/**
    createProcess generates a Process object from ProcessOptions
*/
export function createProcess(options: ProcessOptions) {
  const process = {
    options,
    schema: createSchema(
      options.fields,
      options.sourceIntegration,
      options.targetIntegration,
    ),
  };
  if (!validateProcess(process)) {
    throw new Error("Invalid process");
  }
  return process;
}

/**
    createSchema generates the necessary graphql schema to facilitate
    generating source and target queries
*/
export function createSchema(
  fields: Array<MappedField>,
  sourceIntegration: Integration,
  targetIntegration: Integration,
) {
  return new GraphQLSchema({
    query: createQuerySchema(fields, sourceIntegration.resolveQuery),
    mutation: createMutationSchema(fields, targetIntegration.resolveMutation),
  });
}

/**
  createQueryObjectType generates a graphql object type for querying an integration
*/
export function createQuerySchema(
  fields: Array<MappedField>,
  resolver: Integration["resolveQuery"],
) {
  // Generate query fields for each field in the target integration
  const queryFields = fields.map((f) => ({
    [f.sourceField.key]: {
      type: GraphQLString,
      resolve() {
        return resolver(f.sourceField.key);
      },
    },
  }));

  return new GraphQLObjectType({
    name: "RootQueryType",
    fields: queryFields.reduce((acc, f) => ({ ...acc, ...f }), {}),
  });
}

/**
  createMutationObjectType generates a graphql object type for mutating an integration
*/
export function createMutationSchema(
  fields: Array<MappedField>,
  resolver: Integration["resolveMutation"],
) {
  // Generate mutation fields for each field in the target integration with formatted
  // field name and the resolved query value as it's argument
  const mutateFields = fields.map((f) => ({
    [f.targetField.key]: {
      type: GraphQLString,
      args: {
        resolvedQuery: { type: GraphQLString },
      },
      resolve(_: any, args: { resolvedQuery: string }) {
        return resolver(f.targetField.key, args.resolvedQuery);
      },
    },
  }));

  return new GraphQLObjectType({
    name: "RootMutationType",
    fields: mutateFields.reduce((acc, f) => ({ ...acc, ...f }), {}),
  });
}

/**
  createQueryString generates an actual query string from a given schema
  and field mappings
*/
export function createQueryString(schema: GraphQLSchema): string {
  const queryType = schema.getQueryType();
  if (!queryType) {
    throw new Error("Schema has no query type defined");
  }

  const fields = Object.keys(queryType.getFields()).join(" ");
  return `query{${fields}}`;
}

/**
  createMutationString generates an actual mutation string from a given schema, using
  fields to map the resolved values from query results.
*/
export function createMutationString(
  schema: GraphQLSchema,
  fieldMappings: Array<MappedField>,
  queryResults: Record<string, any>,
): string {
  const mutationType = schema.getMutationType();
  if (!mutationType) {
    throw new Error("Schema has no mutation type defined");
  }

  const fields = Object.entries(mutationType.getFields())
    .map(([mutationFieldName]) => {
      // fieldName is currently in form `setFieldName` so we convert it to `fieldName`
      const queryFieldName = findQueryFieldName(
        fieldMappings,
        mutationFieldName,
      );
      if (!queryFieldName) {
        throw new Error(
          `Could not find query field for mutation field: ${mutationFieldName}`,
        );
      }
      const value = queryResults[queryFieldName];
      return `${mutationFieldName}(resolvedQuery:"${value}")`;
    })
    .join(" ");

  return `mutation{${fields}}`;
}

/**
  resolveSource resolves the source integration query to a data record
*/
export async function resolveSource(process: Process) {
  const query = createQueryString(process.schema);
  const result = await graphql({ schema: process.schema, source: query });
  if (result.errors) {
    throw new Error(`Query execution failed: ${result.errors}`);
  }
  if (!result.data) {
    throw new Error(`Query data unavailable: ${result.errors}`);
  }
  return result.data;
}

/**
    resolveTarget resolves the target integration mutation based on pre-resolved
    data records
*/
export async function resolveTarget(
  process: Process,
  queryResults: Record<string, any>,
) {
  const mutation = createMutationString(
    process.schema,
    process.options.fields,
    queryResults,
  );
  const result = await graphql({ schema: process.schema, source: mutation });
  if (result.errors) {
    throw new Error(`Mutation execution failed: ${result.errors}`);
  }
  return result.data || null;
}

/**
    validateProcess validates a Process object to ensure it is correctly
    structured and can be used to sync data between integrations

    checks with invariant if:
    - fields are defined
    - fields are not empty
    - fields are unique (no duplicate keys in source or target. source can have
      duplicate keys with target)
    - source and target integrations are defined
    - source and target integrations are not the same table (todo, tables are nyi)
    - source has a resolveQuery function
    - target has a resolveMutation function
    - schema is defined
    - schema has a query type
    - schema has a mutation type
    - schema has as many query fields as there are mutation fields
*/
export function validateProcess(process: Process) {
  try {
    // First make sure everything exists
    invariant(process, "Process is required");
    invariant(process.options, "Options are required");
    invariant(process.options.fields, "Fields are required");
    invariant(
      process.options.sourceIntegration,
      "Source integration is required",
    );
    invariant(
      process.options.targetIntegration,
      "Target integration is required",
    );
    invariant(process.schema, "Schema is required");

    const {
      options: { fields, sourceIntegration, targetIntegration },
      schema,
    } = process;

    // Then make sure everything is as expected. Zod would probably be better
    // here
    invariant(fields.length > 0, "Fields cannot be empty");

    invariant(
      fields.length === new Set(fields.map((f) => f.sourceField.key)).size,
      "Source fields must be unique",
    );
    invariant(
      fields.length === new Set(fields.map((f) => f.targetField.key)).size,
      "Target fields must be unique",
    );

    invariant(
      sourceIntegration.resolveQuery,
      "Source must have a resolveQuery",
    );
    invariant(
      targetIntegration.resolveMutation,
      "Target must have a resolveMutation",
    );

    invariant(schema.getQueryType(), "Schema must have a query type");
    invariant(schema.getMutationType(), "Schema must have a mutation type");

    invariant(
      Object.keys(schema.getQueryType()?.getFields() || {}).length ===
        Object.keys(schema.getMutationType()?.getFields() || {}).length,
      "Schema must have as many query fields as there are mutation fields",
    );
  } catch (error: any) {
    console.error("Validation failed", error.message);
    return false;
  }
  return true;
}

/**
    sync synchronizes a given process
*/
export async function sync(process: Process) {
  if (!validateProcess(process)) {
    console.warn("Process is invalid");
    return null;
  }

  try {
    const queryResults = await resolveSource(process);
    const mutationResults = await resolveTarget(process, queryResults);
    console.log("Process synced", mutationResults);
    return mutationResults;
  } catch (error: any) {
    console.error("Process sync failed", error.message);
    return null;
  }
}
