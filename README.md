# nanosync

A simple and unopinionated library for syncing field data between any two integrations.

## Installation

```bash
npm install @dejean/nanosync
```

## Usage

```javascript
import { createProcess, sync } from "@dejean/nanosync";
import { airtable, postgres } from "./integrations";

const collection = "users";

const fields = [
  {
    sourceField: { key: "name", type: "string" },
    targetField: { key: "fullName", type: "string" },
  },
  {
    sourceField: { key: "age", type: "number" },
    targetField: { key: "userAge", type: "number" },
  },
];

const process = createProcess({
  fields,
  collection,
  sourceIntegration: airtable,
  targetIntegration: postgres,
});

/* Validates the process before executing. If successful, returns mutation results. else, `null`  */
await sync(process);
```
