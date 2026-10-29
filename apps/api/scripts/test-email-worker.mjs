import assert from "node:assert/strict";
import { createServer } from "node:net";

const { createEmailConnector } = await import("../src/modules/email-worker/service.ts");

async function withSmtpServer(run) {
  let received = "";
  const server = createServer((socket) => {
    socket.write("220 test SMTP ready\r\n");
    let buffer = "";
    let readingMessage = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n");
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (readingMessage) {
          if (line === ".") {
            readingMessage = false;
            socket.write("250 message accepted\r\n");
          } else received += `${line}\n`;
          continue;
        }
        if (line.startsWith("EHLO ")) socket.write("250-test.local\r\n250 SIZE 1000000\r\n");
        else if (line.startsWith("MAIL FROM:")) socket.write("250 sender accepted\r\n");
        else if (line.startsWith("RCPT TO:")) socket.write("250 recipient accepted\r\n");
        else if (line === "DATA") { readingMessage = true; socket.write("354 send message\r\n"); }
        else if (line === "QUIT") { socket.write("221 goodbye\r\n"); socket.end(); }
        else socket.write("500 unexpected command\r\n");
      }
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const address = server.address();
    await run(address.port, () => received);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function mockPool(port, { suppressed = false, failUserLookup = false } = {}) {
  return {
    async query(sql) {
      if (sql.includes("FROM installation_email_settings")) return { rows: [{
        mode: "smtp", enabled: true, from_name: "Smart Church", from_email: "noreply@example.org",
        smtp_host: "127.0.0.1", smtp_port: port, smtp_security: "none", smtp_username: "",
        encrypted_smtp_password: null,
      }] };
      if (sql.includes("FROM app_users")) {
        if (failUserLookup) throw new Error("Transactional-address delivery should not look up an account.");
        return { rows: [{ email: "member@example.net" }] };
      }
      if (sql.includes("module_notification_email_suppressions")) return { rowCount: suppressed ? 1 : 0, rows: [] };
      throw new Error(`Unexpected email-worker query: ${sql}`);
    },
  };
}

async function testDelivery() {
  await withSmtpServer(async (port, getMessage) => {
    const connector = createEmailConnector(mockPool(port), () => true);
    assert.equal(await connector.isConfigured(), true);
    const result = await connector.send({
      recipientUserId: "45b66dd5-ff04-49f0-a8d1-abc447422d91",
      subject: "Service update",
      text: "The service starts at 10.",
    });
    assert.match(result.messageId, /^<[\da-f-]{36}@example\.org>$/);
    assert.match(getMessage(), /To: member@example\.net/);
    assert.match(getMessage(), /Subject: Service update/);
    assert.match(getMessage(), /VGhlIHNlcnZpY2Ugc3RhcnRzIGF0IDEwLg==/);
  });
}

async function testSuppression() {
  await withSmtpServer(async (port) => {
    const connector = createEmailConnector(mockPool(port, { suppressed: true }), () => true);
    await assert.rejects(connector.send({
      recipientUserId: "45b66dd5-ff04-49f0-a8d1-abc447422d91",
      subject: "Service update",
      text: "The service starts at 10.",
    }), /unavailable for this recipient/i);
  });
}

async function testTransactionalAddressDelivery() {
  await withSmtpServer(async (port, getMessage) => {
    const connector = createEmailConnector(mockPool(port, { failUserLookup: true }), () => true);
    await connector.send({
      recipientEmail: "signup@example.net",
      subject: "Confirm your account",
      text: "Use the secure confirmation link.",
    });
    assert.match(getMessage(), /To: signup@example\.net/);
    assert.match(getMessage(), /Subject: Confirm your account/);
  });
}

await testDelivery();
await testSuppression();
await testTransactionalAddressDelivery();
console.log("Email worker tests passed: SMTP delivery, user-ID lookup, transactional-address delivery, and suppression handling.");
