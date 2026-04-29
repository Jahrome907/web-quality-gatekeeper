/* global console, process */
import { runChecked } from "./_shared.mjs";

function actionSmokeEnv() {
  if (process.env.CI === "true" || process.env.WQG_ACTION_SMOKE_REQUIRED === "true") {
    return { WQG_ACTION_SMOKE_REQUIRED: "true" };
  }
  return {};
}

async function runReleaseDryRun() {
  for (const command of [
    { binary: "npm", args: ["run", "validate:full"], timeout: 10 * 60 * 1000 },
    { binary: "npm", args: ["run", "contracts:check"] },
    { binary: "npm", args: ["run", "security:audit"] },
    { binary: "npm", args: ["run", "smoke:pack"] },
    {
      binary: "npm",
      args: ["run", "smoke:action"],
      env: actionSmokeEnv()
    }
  ]) {
    await runChecked(command.binary, command.args, {
      env: command.env,
      timeout: command.timeout
    });
  }

  console.log("Release dry-run checks completed.");
}

runReleaseDryRun();
