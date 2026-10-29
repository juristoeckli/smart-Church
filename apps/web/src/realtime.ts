export type RealtimeEvent = { topic: string; departmentId: string; payload?: unknown };
export type RealtimeListener = (event: RealtimeEvent) => void;

const listeners = new Map<string, Set<RealtimeListener>>();
let enabled = false;
let departmentId = "";
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempt = 0;
let generation = 0;

function dispatch(event: RealtimeEvent) {
  for (const listener of listeners.get(event.topic) ?? []) listener(event);
}

function scheduleReconnect(connectionGeneration: number) {
  if (!enabled || connectionGeneration !== generation || reconnectTimer !== null) return;
  const delay = Math.min(30_000, 500 * (2 ** Math.min(reconnectAttempt, 6)));
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    openSocket(connectionGeneration);
  }, delay);
}

function openSocket(connectionGeneration: number) {
  if (!enabled || !departmentId || connectionGeneration !== generation || socket) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/api/realtime?departmentId=${encodeURIComponent(departmentId)}`;
  const connection = new WebSocket(url);
  socket = connection;
  connection.onopen = () => {
    if (connectionGeneration !== generation) { connection.close(); return; }
    reconnectAttempt = 0;
  };
  connection.onmessage = (message) => {
    if (connectionGeneration !== generation || typeof message.data !== "string") return;
    try {
      const event = JSON.parse(message.data) as RealtimeEvent;
      if (event && typeof event.topic === "string" && event.departmentId === departmentId) dispatch(event);
    } catch { /* Ignore malformed notifications and keep the connection available. */ }
  };
  connection.onclose = () => {
    if (socket === connection) socket = null;
    scheduleReconnect(connectionGeneration);
  };
  connection.onerror = () => connection.close();
}

export function configureRealtime(nextDepartmentId: string, shouldConnect: boolean) {
  const nextEnabled = shouldConnect && Boolean(nextDepartmentId);
  if (enabled === nextEnabled && departmentId === (nextEnabled ? nextDepartmentId : "")) return;
  enabled = nextEnabled;
  departmentId = nextEnabled ? nextDepartmentId : "";
  generation += 1;
  reconnectAttempt = 0;
  if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const previous = socket;
  socket = null;
  previous?.close();
  if (enabled) openSocket(generation);
}

export function subscribeRealtime(topic: string, listener: RealtimeListener) {
  const subscribers = listeners.get(topic) ?? new Set<RealtimeListener>();
  subscribers.add(listener);
  listeners.set(topic, subscribers);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(topic);
  };
}

export function sendRealtime(topic: string, payload?: unknown) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ topic, payload }));
  return true;
}

export function isRealtimeConnected() {
  return socket?.readyState === WebSocket.OPEN;
}
