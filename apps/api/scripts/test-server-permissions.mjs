import assert from "node:assert/strict";
import { allServerPermissions, hasServerPermission, serverPermissionsForUser } from "../src/server-permissions.ts";

assert.deepEqual(serverPermissionsForUser("server_admin", []), ["server_view", "server_troubleshoot", "server_manage"]);
assert.deepEqual(serverPermissionsForUser("user", null), []);
assert.equal(hasServerPermission("server_admin", [], "server_manage"), true);
assert.equal(hasServerPermission("user", ["server_view"], "server_view"), true);
assert.equal(hasServerPermission("user", ["server_view"], "server_troubleshoot"), false);
assert.equal(hasServerPermission("user", ["server_troubleshoot"], "server_manage"), false);
assert.equal(hasServerPermission("user", ["server_manage"], "server_manage"), true);
assert.equal(allServerPermissions.length, 3);

console.log("Server permission tests passed: grants are independent and full administrators retain all rights.");
