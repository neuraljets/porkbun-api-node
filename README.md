# porkbun-api-node

Node.js client for the Porkbun API, written in TypeScript.

## Installation

This package is not yet published to npm. To install it, you can install it directly from GitHub:

```bash
npm install --save neuraljets/porkbun-api-node
```

Or you can clone the repository and install it from the local directory (assumed here to be `../porkbun-api-node`):

```bash
npm install --save ../porkbun-api-node
```

## Usage

```typescript
import { PorkbunAPI } from "porkbun-api-node";

const porkbun = new PorkbunAPI({
  apiKey: "your-api-key",
  secretApiKey: "your-secret-api-key",
});

porkbun.listDomains().then(({ domains }) => {
  console.log(domains);
});
```
