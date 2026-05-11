/* global console, process */
import { spawnSync } from "node:child_process";

const testArgs = ["-m", "unittest", "discover", "-s", "tools/python/tests"];
const candidates =
  process.platform === "win32"
    ? [
        ["py", ["-3", ...testArgs]],
        ["python3", testArgs],
        ["python", testArgs]
      ]
    : [
        ["python3", testArgs],
        ["python", testArgs]
      ];

for (const [command, args] of candidates) {
  const version = spawnSync(command, ["--version"], {
    encoding: "utf8",
    shell: false
  });

  if (version.error || version.status !== 0) {
    continue;
  }

  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    stdio: "inherit"
  });

  process.exit(result.status ?? 1);
}

console.error("Python smoke failed: no usable Python interpreter found.");
process.exit(1);
