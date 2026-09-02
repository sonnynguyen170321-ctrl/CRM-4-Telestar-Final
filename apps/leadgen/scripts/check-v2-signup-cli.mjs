import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cli = readFileSync(new URL("./v2-signup.mjs", import.meta.url), "utf8");

assert.match(cli, /--email/);
assert.match(cli, /V2_AUTH_SECRET is required/);
assert.match(cli, /const ROLES = new Set\(\["OWNER", "ADMIN", "MANAGER", "TEAM_LEAD", "SDR", "VIEWER"\]\)/);
assert.match(cli, /generatePassword\(\)/);
assert.match(cli, /TEMP_PASSWORD=/);
assert.match(cli, /reset-password/);
assert.match(cli, /ON CONFLICT \("emailNormalized"\) DO UPDATE/);
assert.match(cli, /ON CONFLICT \("organizationId", "userId"\) DO UPDATE/);
assert.match(cli, /ON CONFLICT \("userId"\) DO UPDATE/);
assert.match(cli, /scrypt/);
assert.match(cli, /process\.env\.V2_AUTH_SECRET/);
assert.match(cli, /scrypt\([^,]+, salt, 64\)/);
assert.doesNotMatch(cli, /Auth0|@auth0|auth0/i);

console.log("PASS V2 signup CLI smoke");