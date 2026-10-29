let closing = false;

function sendStats() {
  if (closing || !process.connected) return;
  const memory = process.memoryUsage();
  process.send?.({ type: "stats", memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal } });
}

process.on("message", (message) => {
  if (message?.type !== "get-time" || typeof message.id !== "string") return;
  const now = new Date();
  process.send?.({ type: "time", id: message.id, utc: now.toISOString(), unixMilliseconds: now.getTime() });
});

process.on("disconnect", () => { closing = true; clearInterval(statsTimer); process.exit(0); });
process.once("SIGTERM", () => { closing = true; clearInterval(statsTimer); process.exit(0); });

process.send?.({ type: "ready" });
sendStats();
const statsTimer = setInterval(sendStats, 10_000);
statsTimer.unref();
