/* global console */
import { runChecked } from "./_shared.mjs";

async function runReleaseDryRun() {
  for (const command of [
    { binary: "npm", args: ["run", "validate:full"] },
    { binary: "npm", args: ["run", "contracts:check"] },
    { binary: "npm", args: ["run", "security:audit"] },
    { binary: "npm", args: ["run", "smoke:pack"] },
    {
      binary: "npm",
      args: ["run", "smoke:action"],
      env: { WQG_ACTION_SMOKE_REQUIRED: "true" }
    }
  ]) {
    await runChecked(command.binary, command.args, {
      env: command.env
    });
  }

  console.log("Release dry-run checks completed.");
}

runReleaseDryRun();
