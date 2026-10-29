# Smart-Church worker SDK

`@smart-church/worker-sdk` connects a Node.js module worker to the authenticated internal WebSocket supplied by the Smart-Church supervisor. It registers the process, validates request envelopes, dispatches only explicitly listed operations, keeps department and actor context separate from request data, bounds concurrent work, and returns concise errors.

```ts
import { connectWorker } from "@smart-church/worker-sdk";

const client = connectWorker({
  url: process.env.SMART_CHURCH_CORE_WS_URL!,
  token: process.env.SMART_CHURCH_WORKER_TOKEN!,
  operations: {
    async status(_data, context) {
      return { departmentId: context.departmentId, online: true };
    },
  },
  onError(error) { console.error(error.message); },
});

await client.ready;
process.on("SIGTERM", () => client.close());
```

Workers must still validate operation inputs and enforce the supplied department scope on every data access. The package does not install or sandbox modules and does not restart workers; Core owns those responsibilities. See [the wire protocol and trust boundaries](../../docs/THIRD_PARTY_WORKER_PROTOCOL.md).
