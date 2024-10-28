import { describe, expect, mock, test } from "bun:test";
import {
  createMutationSchema,
  createQuerySchema,
  createSchema,
  createQueryString,
  createMutationString,
  resolveSource,
  resolveTarget,
  sync,
  createProcess,
  type MappedField,
  type Integration,
  FieldValue,
} from "./nanosync";
import { GraphQLSchema } from "graphql";

const mockSourceIntegration: Integration = {
  name: "source",
  description: "source integration",
  resolveQuery: async (key: string) => FieldValue(`source_${key}_value`),
  resolveMutation: async (key: string, value: string) =>
    FieldValue(`mutated_${key}_${value}`),
};

const mockInvalidSourceIntegration: Integration = {
  name: "source",
  description: "source integration",
  resolveQuery: undefined,
  resolveMutation: async (key: string, value: string) =>
    FieldValue(`mutated_${key}_${value}`),
};

const mockTargetIntegration: Integration = {
  name: "target",
  description: "target integration",
  resolveQuery: (key: string) => FieldValue(`target_${key}_value`),
  resolveMutation: (key: string, value: string) => `mutated_${key}_${value}`,
};

const mockInvalidTargetIntegration: Integration = {
  name: "target",
  description: "target integration",
  resolveQuery: (key: string) => FieldValue(`target_${key}_value`),
  resolveMutation: undefined,
};

const mockMappedFields: Array<MappedField> = [
  {
    sourceField: { key: "name", type: "string" },
    targetField: { key: "fullName", type: "string" },
  },
  {
    sourceField: { key: "age", type: "number" },
    targetField: { key: "userAge", type: "number" },
  },
];

const mockAllFieldTypes: Array<MappedField> = [
  {
    sourceField: { key: "stringField", type: "string" },
    targetField: { key: "stringTarget", type: "string" },
  },
  {
    sourceField: { key: "numberField", type: "number" },
    targetField: { key: "numberTarget", type: "number" },
  },
  {
    sourceField: { key: "booleanField", type: "boolean" },
    targetField: { key: "booleanTarget", type: "boolean" },
  },
  {
    sourceField: { key: "dateField", type: "date" },
    targetField: { key: "dateTarget", type: "date" },
  },
];

const mockInvalidFields: Array<MappedField> = [
  {
    sourceField: { key: "invalidField", type: "invalid" as any },
    targetField: { key: "targetField", type: "string" },
  },
];

test("createProcess creates valid Process object", () => {
  const process = createProcess({
    fields: mockMappedFields,
    sourceIntegration: mockSourceIntegration,
    targetIntegration: mockTargetIntegration,
  });

  expect(process.options).toBeDefined();
  expect(process.schema).toBeDefined();
  expect(process.schema.getQueryType()).toBeDefined();
  expect(process.schema.getMutationType()).toBeDefined();
});

test("createSchema handles all field types correctly", () => {
  const schema = createSchema(
    mockAllFieldTypes,
    mockSourceIntegration,
    mockTargetIntegration,
  );
  expect(Object.keys(schema.getQueryType()!.getFields()).length).toBe(4);
  expect(Object.keys(schema.getMutationType()!.getFields()).length).toBe(4);
});

test("createQueryString generates correct query string", () => {
  const process = createProcess({
    fields: mockMappedFields,
    sourceIntegration: mockSourceIntegration,
    targetIntegration: mockTargetIntegration,
  });
  const queryString = createQueryString(process.schema);
  expect(queryString).toBe("query{name age}");
});

test("createMutationString generates correct mutation string", () => {
  const process = createProcess({
    fields: mockMappedFields,
    sourceIntegration: mockSourceIntegration,
    targetIntegration: mockTargetIntegration,
  });
  const queryResults = {
    name: "source_name_value",
    age: "source_age_value",
  };
  const mutationString = createMutationString(
    process.schema,
    process.options.fields,
    queryResults,
  );
  expect(mutationString).toBe(
    'mutation{fullName(resolvedQuery:"source_name_value") userAge(resolvedQuery:"source_age_value")}',
  );
});

test("resolveSource successfully resolves source query", async () => {
  const process = createProcess({
    fields: mockMappedFields,
    sourceIntegration: mockSourceIntegration,
    targetIntegration: mockTargetIntegration,
  });
  const result = await resolveSource(process);
  expect(result).toHaveProperty("name");
  expect(result).toHaveProperty("age");
});

test("resolveTarget successfully resolves target mutation", async () => {
  const process = createProcess({
    fields: mockMappedFields,
    sourceIntegration: mockSourceIntegration,
    targetIntegration: mockTargetIntegration,
  });
  const queryResults = {
    name: "John Doe",
    age: "30",
  };
  const result = await resolveTarget(process, queryResults);
  expect(result).toBeDefined();
});

test("sync successfully completes sync operation", async () => {
  const process = createProcess({
    fields: mockMappedFields,
    sourceIntegration: mockSourceIntegration,
    targetIntegration: mockTargetIntegration,
  });

  const mockLog = mock((message) => {});
  const originalLog = console.log;
  console.log = mockLog;

  await sync(process);

  expect(mockLog).toHaveBeenCalledWith("Process synced", expect.any(Object));

  console.log = originalLog;
});
