export type WorkerRequestContext = {
  departmentId: string;
  actor: string;
};

export type WorkerOperation = (
  data: Record<string, unknown>,
  context: WorkerRequestContext,
) => unknown | Promise<unknown>;

export type WorkerClientOptions = {
  /** Internal WebSocket URL supplied by the Core supervisor. */
  url: string;
  /** Per-process registration token supplied by the Core supervisor. */
  token: string;
  /** Operation names are an allowlist; unknown operations are rejected. */
  operations: Record<string, WorkerOperation>;
  /** Called after the Core acknowledges registration. */
  onReady?: () => void;
  /** Called when the connection closes. The supervisor owns restart policy. */
  onClose?: (event: CloseEvent) => void;
  /** Called for transport or protocol errors that can be reported locally. */
  onError?: (error: Error) => void;
  /** Maximum number of operations handled concurrently. Defaults to eight. */
  maxConcurrentRequests?: number;
};

export type WorkerClient = {
  /** Resolves once Core acknowledges the registration. */
  ready: Promise<void>;
  /** Sends a WebSocket close frame. */
  close: (reason?: string) => void;
};

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function messageError(value: unknown) {
  const raw = value instanceof Error ? value.message : "Operation failed.";
  return raw
    .replace(/\b(password|secret|token|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
    .slice(0, 500) || "Operation failed.";
}

function validRequestContext(value: JsonObject): value is JsonObject & { departmentId: string; actor: string; id: string; operation: string; data: JsonObject } {
  return typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128
    && typeof value.operation === "string" && value.operation.length > 0 && value.operation.length <= 120
    && typeof value.departmentId === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value.departmentId)
    && typeof value.actor === "string" && value.actor.length > 0 && value.actor.length <= 128
    && isRecord(value.data);
}

/**
 * Connects a Node worker to Smart-Church Core and dispatches authenticated
 * operations. It does not reconnect: the Core supervisor starts a fresh child
 * with a fresh token after an unexpected disconnect.
 */
export function connectWorker(options: WorkerClientOptions): WorkerClient {
  if (!options.url.trim() || !options.token.trim()) throw new Error("A Core WebSocket URL and worker token are required.");
  const maxConcurrentRequests = options.maxConcurrentRequests ?? 8;
  if (!Number.isInteger(maxConcurrentRequests) || maxConcurrentRequests < 1 || maxConcurrentRequests > 128) {
    throw new Error("maxConcurrentRequests must be an integer between 1 and 128.");
  }

  const socket = new WebSocket(options.url);
  let registered = false;
  let closed = false;
  let activeRequests = 0;
  const ready = new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => {
      if (closed) return;
      socket.send(JSON.stringify({ type: "register", token: options.token }));
    }, { once: true });
    socket.addEventListener("message", (event) => {
      let message: unknown;
      try { message = JSON.parse(String(event.data)); }
      catch {
        const error = new Error("Core sent an invalid worker protocol message.");
        options.onError?.(error);
        socket.close(1002, "invalid protocol message");
        if (!registered) reject(error);
        return;
      }
      if (!isRecord(message) || typeof message.type !== "string") {
        socket.close(1002, "invalid protocol message");
        return;
      }
      if (!registered) {
        if (message.type !== "registered") {
          const error = new Error("Core did not acknowledge worker registration.");
          options.onError?.(error);
          socket.close(1008, "registration required");
          reject(error);
          return;
        }
        registered = true;
        resolve();
        try { options.onReady?.(); }
        catch (error) { options.onError?.(error instanceof Error ? error : new Error("Worker readiness callback failed.")); }
        return;
      }
      if (message.type !== "request") return;
      if (!validRequestContext(message)) {
        socket.close(1002, "invalid request");
        return;
      }
      const requestId = message.id;
      const operation = Object.hasOwn(options.operations, message.operation) ? options.operations[message.operation] : undefined;
      if (!operation) {
        socket.send(JSON.stringify({ type: "response", id: requestId, error: "Unsupported operation." }));
        return;
      }
      if (activeRequests >= maxConcurrentRequests) {
        socket.send(JSON.stringify({ type: "response", id: requestId, error: "Worker is busy. Try again shortly." }));
        return;
      }

      activeRequests += 1;
      void Promise.resolve().then(() => operation(message.data, {
        departmentId: message.departmentId,
        actor: message.actor,
      })).then((result) => {
        if (!closed && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "response", id: requestId, result: result ?? null }));
        }
      }).catch((error: unknown) => {
        options.onError?.(error instanceof Error ? error : new Error("Worker operation failed."));
        if (!closed && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "response", id: requestId, error: messageError(error) }));
        }
      }).finally(() => { activeRequests -= 1; });
    });
    socket.addEventListener("error", () => {
      const error = new Error("The worker could not connect to Smart-Church Core.");
      options.onError?.(error);
      if (!registered) reject(error);
    });
    socket.addEventListener("close", (event) => {
      closed = true;
      if (!registered) reject(new Error("Core closed the worker connection before registration completed."));
      options.onClose?.(event);
    });
  });

  return {
    ready,
    close: (reason = "worker stopping") => {
      if (closed || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) return;
      socket.close(1000, reason.slice(0, 120));
    },
  };
}
