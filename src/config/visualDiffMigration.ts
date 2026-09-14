export const NATIVE_VISUAL_DIFF_REMOVAL_GUIDANCE =
  'The native Rust visual diff engine has been removed. Use visual.engine: "pixelmatch", remove visual.nativeBinaryPath, unset WQG_VISUAL_DIFF_ENGINE and WQG_VISUAL_DIFF_NATIVE_BIN, and review baselines.';

export function assertSupportedVisualDiffEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const engine = env.WQG_VISUAL_DIFF_ENGINE;
  if (engine && engine !== "pixelmatch") {
    throw new Error(
      `WQG_VISUAL_DIFF_ENGINE=${JSON.stringify(engine)} is no longer supported. ${NATIVE_VISUAL_DIFF_REMOVAL_GUIDANCE}`
    );
  }

  if (env.WQG_VISUAL_DIFF_NATIVE_BIN) {
    throw new Error(
      `WQG_VISUAL_DIFF_NATIVE_BIN is no longer supported. ${NATIVE_VISUAL_DIFF_REMOVAL_GUIDANCE}`
    );
  }
}
