import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    sourcemap: true,
    clean: true,
    target: "node22",
    outDir: "dist",
    banner: {
      js: "#!/usr/bin/env node"
    }
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    sourcemap: true,
    clean: false,
    target: "node22",
    outDir: "dist",
    dts: {
      compilerOptions: {
        ignoreDeprecations: "6.0"
      }
    }
  }
]);
