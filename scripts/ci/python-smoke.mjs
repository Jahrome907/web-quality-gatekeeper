/* global console, process */
import { spawnSync } from "node:child_process";

const testArgs = ["-m", "unittest", "discover", "-s", "tools/python/tests"];
const configuredPython = process.env.WQG_PYTHON?.trim();
const configuredCandidates = configuredPython ? [[configuredPython, testArgs]] : [];
const discoveredCandidates =
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
const candidates = [...configuredCandidates, ...discoveredCandidates];
const diagnostics = [];
const pythonEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };

for (const [command, args] of candidates) {
  const version = spawnSync(command, ["--version"], {
    encoding: "utf8",
    env: pythonEnv,
    shell: false
  });

  if (version.error) {
    diagnostics.push(`${command}: ${version.error.code ?? version.error.message}`);
    continue;
  }

  if (version.status !== 0) {
    diagnostics.push(`${command}: --version exited ${version.status ?? "unknown"}`);
    continue;
  }

  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: pythonEnv,
    shell: false,
    stdio: "inherit"
  });

  process.exit(result.status ?? 1);
}

console.error(
  "Python smoke failed: no usable Python interpreter found. Set WQG_PYTHON to a Python executable path."
);
if (diagnostics.length > 0) {
  console.error(`Interpreter checks: ${diagnostics.join("; ")}`);
}
process.exit(1);
