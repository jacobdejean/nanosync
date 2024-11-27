/**
     ____  ____ _____  ____  _______  ______  _____ __________
    / __ \/ __ `/ __ \/ __ \/ ___/ / / / __ \/ ___// ___/ ___/
   / / / / /_/ / / / / /_/ (__  ) /_/ / / / / /___/ /__/ /__
  /_/ /_/\__,_/_/ /_/\____/____/\__, /_/ /_/\___(_)___/\___/
                               /____/

  A simple and unopinionated library for syncing field data.

  It accomplishes this through a simple, standardized API for
  building integrations and managing the complexities between
  them.
*/

import {
  graphql,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";

import invariant from "tiny-invariant";

/**
    A SyncProcess is created by the user to represent a connection
    between two integrations
*/
export type SyncProcess = {
  readonly schema: GraphQLSchema;
  readonly source: IntegrationInstance;
  readonly target: IntegrationInstance;
};

/**
    The field mapping and integration definitions get built into
    a SyncProcess, who's schema is the source of truth thereafter
*/
export type SyncProcessOptions = {
  readonly fields: Array<MappedField>;
  readonly sourceIntegration: IntegrationDefinition;
  readonly targetIntegration: IntegrationDefinition;
};

/**
    I don't know if the core sync process should worry about field
    types. Perhaps offload type validation to the integrations. For
    now it doesn't matter
*/
export type FieldType = "string";
// | "number"
// | "boolean"
// | "date"
// | "time"
// | "datetime"
// | "json"
// | "array"
// | "object"
// | "custom";

/**
    Again, we could consider more here but this is where I'm starting
*/
export type FieldValue = string; /* | number | boolean | null | object; */

/**
  A field in a source or target integration
  mapped to a standardized nanosync type
*/
export type Field = {
  key: string;
  type: FieldType;
};

/**
    Once two fields have been matched they can be referred to as 'source'
    and 'target' fields
*/
export type MappedField = {
  source: Field;
  target: Field;
};

/**
    The integration definition stores basic information about a service
    as well as the necessary callbacks to resolve a sync process.
*/
export type IntegrationDefinition = {
  name: string;
  description: string;

  /**
    Called before connection to request any necessary credentials
  */
  authenticate: () => Promise<boolean>;

  /**
    connect should return a client that is used by other callbacks to
    operate on the resource
  */
  connect: () => Promise<IntegrationClient>;

  /**
    The integration needs to be read from, you tell me how
  */
  query: <T extends FieldValue = FieldValue>(
    keys: Array<string>,
  ) => Array<Promise<T>>;

  /**
    The integration needs to be written to, you tell me how
  */
  mutate: <T extends FieldValue = FieldValue>(
    fields: Record<string, T>,
  ) => Array<Promise<T>>;

  /**
    The disconnect callback should clean up and close any connections
    Called before unauthentication
  */
  disconnect: () => Promise<boolean>;

  /**
    If a service requires some king of session instead of just a token,
    this provides an opportunity to end that session
  */
  unauthenticate: () => Promise<boolean>;
};

/**
    The client returned by the integration's `connect` procedure
*/
export type IntegrationClient = any;

export type IntegrationProperties = Record<string, string>;

export type IntegrationOptions = {
  properties: IntegrationProperties;
  secrets: Record<string, string>;
} & IntegrationDefinition;

export type IntegrationInstance = {
  client: IntegrationClient;
  properties: IntegrationProperties;
  secrets: Record<string, string>;
} & IntegrationDefinition;

/**
    findQueryFieldName finds the source field key given a target field key
*/
export const findQueryFieldName = (
  fields: Array<MappedField>,
  mutationFieldName: string,
) => fields.find((f) => mutationFieldName === f.target.key)?.source.key;

/**
    findMutationFieldName finds the target field key given a source field key
*/
export const findMutationFieldName = (
  fields: Array<MappedField>,
  queryFieldName: string,
) => fields.find((f) => queryFieldName === f.source.key)?.target.key;

/**
    This cast is just used for mocking
*/
export const FieldValue = (value: any) => String(value) as FieldValue;

/**
    createProcess generates a schema and
*/
export function createProcess(options: SyncProcessOptions) {
  const process = {
    schema: createSchema(
      options.fields,
      options.sourceIntegration,
      options.targetIntegration,
    ),
    source: options.sourceIntegration,
    target: options.targetIntegration,
  };
  if (!validateProcess(process)) {
    throw new Error("Invalid process");
  }
  return process;
}

/**
    createIntegration generates an Integration object from IntegrationOptions.
    This api will see a lot of evolution over the next few commits
*/
export function defineIntegration(options: IntegrationOptions) {
  return {
    ...options,
  };
}

export function connectIntegration(integration: IntegrationDefinition) {
  const client = integration.connect();
}

export function disconnectIntegration(integration) {}

export function authenticateIntegration(integration) {}

export function unauthenticateIntegration(integration) {}

export function queryIntegration(integration) {}

export function mutateIntegration(integration) {}

/**
    createSchema generates the necessary graphql schema to facilitate
    generating source and target queries
*/
export function createSchema(
  fields: Array<MappedField>,
  sourceIntegration: IntegrationDefinition,
  targetIntegration: IntegrationDefinition,
) {
  return new GraphQLSchema({
    query: createQuerySchema(fields),
    mutation: createMutationSchema(fields),
  });
}

/**
  createQueryObjectType generates a graphql object type for querying an integration
*/
export function createQuerySchema(
  fields: Array<MappedField>,
  integrationName: string,
) {
  // Generate query fields for each field in the target integration
  const queryFields = fields.map((f) => ({
    [f.source.key]: {
      type: GraphQLString,
      description: createSchemaDescription({
        key: f.source.key,
        target: f.target.key,
        integration: integrationName,
      }),
      resolve(source: Record<string, FieldValue>) {
        if (!(f.source.key in source)) {
          throw new Error("Source key not found in source response");
        }
        return source[f.source.key];
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
  integrationName: string,
) {
  // Generate mutation fields for each field in the target integration with formatted
  // field name and the resolved query value as it's argument
  const mutateFields = fields.map((f) => ({
    [f.target.key]: {
      type: GraphQLString,
      args: {
        resolvedQuery: { type: GraphQLString },
      },
      description: createSchemaDescription({
        key: f.target.key,
        source: f.source.key,
        integration: integrationName,
      }),
      resolve(
        source: Record<string, FieldValue>,
        args: Record<string, FieldValue>,
      ) {
        return args.resolvedQuery;
      },
    },
  }));

  return new GraphQLObjectType({
    name: "RootMutationType",
    fields: mutateFields.reduce((acc, f) => ({ ...acc, ...f }), {}),
  });
}

/**
  For serialization purposes we keep metadata about a given
  schema in it's description field
*/
export function createSchemaDescription(properties: Record<string, string>) {
  return JSON.stringify(properties);
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
  queryResults: Record<string, any>,
): string {
  const mutationType = schema.getMutationType();
  if (!mutationType) {
    throw new Error("Schema has no mutation type defined");
  }

  const fields = Object.entries(mutationType.getFields())
    .map(([mutationFieldName]) => {
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
export async function resolveSource(process: SyncProcess) {
  const query = createQueryString(process.schema);
  const rootValue = {};
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
  process: SyncProcess,
  queryResults: Record<string, any>,
) {
  const mutation = createMutationString(process.schema, queryResults);
  const rootValue = {};
  const result = await graphql({
    schema: process.schema,
    source: mutation,
    rootValue,
  });
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
export function validateProcess(process: SyncProcess) {
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
export async function sync(process: SyncProcess) {
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
