import { spawnSync } from "node:child_process";

const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmBin, ["run", "test", "--", "lib/v2/identity"], {
  shell: process.platform === "win32",
  stdio: "inherit",
});

process.exit(result.status ?? 1);
