/* global console */
import { runChecked } from "./_shared.mjs";

async function runReleaseDryRun() {
  for (const command of [
    ["npm", ["run", "validate:full"]],
    ["npm", ["run", "contracts:check"]],
    ["npm", ["run", "security:audit"]],
    ["npm", ["run", "smoke:pack"]],
    ["npm", ["run", "smoke:action"]]
  ]) {
    const [binary, args] = command;
    await runChecked(binary, args);
  }

  console.log("Release dry-run checks completed.");
}

runReleaseDryRun();
