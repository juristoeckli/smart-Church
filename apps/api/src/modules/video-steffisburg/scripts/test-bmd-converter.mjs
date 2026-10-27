import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("../bmd-converter-worker.js", import.meta.url));
const [command, ...args] = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  pnpm --filter @smart-church/api test:converter -- discover
  pnpm --filter @smart-church/api test:converter -- read
  pnpm --filter @smart-church/api test:converter -- read-levels
  pnpm --filter @smart-church/api test:converter -- set <raw-level 0..255>
  pnpm --filter @smart-church/api test:converter -- set-analog-levels <ch1> <ch2> <ch3> <ch4>

Reads BMD_CONVERTER_DS700_HOST, BMD_CONVERTER_DS700_PORT, and optional
BMD_CONVERTER_CLIENT_MAC from the environment (or the repository .env file
when run with the package script). The set command changes the converter's
AES/EBU input-level raw value.`);
}

if (command === "--help" || command === "-h") {
  usage();
  process.exit(0);
}

if (!["discover", "read", "read-levels", "set", "set-analog-levels"].includes(command)) {
  usage();
  process.exit(2);
}

if (!process.env.BMD_CONVERTER_DS700_HOST?.trim()) {
  console.error("BMD_CONVERTER_DS700_HOST is not configured.");
  process.exit(2);
}

let level;
let levels;
if (command === "set") {
  level = Number(args[0]);
  if (args.length !== 1 || !/^\d+$/.test(args[0] ?? "") || !Number.isInteger(level) || level < 0 || level > 255) {
    console.error("Raw AES/EBU level must be an integer from 0 through 255.");
    process.exit(2);
  }
} else if (command === "set-analog-levels") {
  levels = args.map(Number);
  if (args.length !== 4 || args.some((value, index) => !/^\d+$/.test(value) || !Number.isInteger(levels[index]) || levels[index] < 0 || levels[index] > 255)) {
    console.error("Four analog raw levels from 0 through 255 are required, in Ch 1 through Ch 4 order.");
    process.exit(2);
  }
} else if (args.length) {
  usage();
  process.exit(2);
}

const child = fork(workerPath, [], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "inherit", "inherit", "ipc"],
  execArgv: [],
  windowsHide: true,
});

let finished = false;
let startupTimer;
let operationTimer;

function stopWorker() {
  if (child.connected) child.disconnect();
  const killTimer = setTimeout(() => child.kill(), 1_000);
  killTimer.unref();
}

function fail(message, exitCode = 1) {
  if (finished) return;
  finished = true;
  clearTimeout(startupTimer);
  clearTimeout(operationTimer);
  console.error(JSON.stringify({ operation: command, error: message }, null, 2));
  stopWorker();
  process.exitCode = exitCode;
}

child.once("error", (error) => fail(`Could not start the Video worker: ${error.message}`));
child.on("exit", (code, signal) => {
  if (!finished) fail(`Video worker exited before returning a result (${signal ?? code ?? "unknown"}).`);
});

startupTimer = setTimeout(() => fail("Video worker did not initialize within 5 seconds."), 5_000);
child.on("message", (message) => {
  if (finished) return;
  if (message?.type === "worker-ready") {
    clearTimeout(startupTimer);
    const id = randomUUID();
    operationTimer = setTimeout(() => fail(`Timed out waiting for ${command} to finish.`), command === "discover" ? 15_000 : 90_000);
    const operation = command === "read" ? "read-aes-level" : command === "read-levels" ? "read-audio-levels" : command === "set" ? "set-aes-level" : command === "set-analog-levels" ? "set-analog-levels" : "discover";
    child.send({ id, operation, ...(level === undefined ? {} : { level }), ...(levels === undefined ? {} : { levels }) }, (error) => {
      if (error) fail(`Could not send request to the Video worker: ${error.message}`);
    });
    return;
  }
  if (message?.type !== "response") return;
  finished = true;
  clearTimeout(startupTimer);
  clearTimeout(operationTimer);
  if (typeof message.error === "string") {
    console.error(JSON.stringify({ operation: command, error: message.error }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ operation: command, result: message.result }, null, 2));
  }
  stopWorker();
});
