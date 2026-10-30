import assert from "node:assert/strict";

const { recordRuntimeLog, registerRuntimeWorker, recentRuntimeLogs, runtimeWorkerDiagnostics } = await import("../src/runtime-diagnostics.ts");

const unregister = registerRuntimeWorker("test:sanitized", "Test worker", () => ({
  status: "failed",
  error: "SMTP rejected request: password=hunter2 Bearer abc.def\r\ncookie: sid=secret",
  uptimeSeconds: null,
  memory: null,
}));
try {
  const worker = runtimeWorkerDiagnostics().find(({ id }) => id === "test:sanitized");
  assert.ok(worker);
  assert.doesNotMatch(worker.error, /hunter2|abc\.def|sid=secret/i);
  assert.match(worker.error, /password=\[redacted\]/i);
  assert.match(worker.error, /Bearer \[redacted\]/i);
  assert.doesNotMatch(worker.error, /[\r\n]/);

  recordRuntimeLog("test", "error", "request failed with token: top-secret\r\nAuthorization: bearer hidden");
  const log = recentRuntimeLogs(1)[0];
  assert.ok(log);
  assert.doesNotMatch(log.message, /top-secret|hidden/i);
  assert.doesNotMatch(log.message, /[\r\n]/);
  console.log("Runtime diagnostics tests passed: worker errors and logs redact credentials and control characters.");
} finally {
  unregister();
}
