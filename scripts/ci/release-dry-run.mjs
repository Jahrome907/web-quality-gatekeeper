/* global console, process */
import { assertNodeEngine } from "./assert-node-engine.mjs";
import { runChecked } from "./_shared.mjs";

function actionSmokeEnv() {
  return { WQG_ACTION_SMOKE_ALLOW_SKIP: "false" };
}

async function runReleaseDryRun() {
  const nodeEngine = assertNodeEngine();
  if (!nodeEngine.ok) {
    throw new Error(nodeEngine.message);
  }
  console.log(nodeEngine.message);

  for (const command of [
    { binary: "npm", args: ["run", "validate:full"], timeout: 10 * 60 * 1000 },
    { binary: "npm", args: ["run", "contracts:check"] },
    { binary: "npm", args: ["run", "python:smoke"] },
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

runReleaseDryRun().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
