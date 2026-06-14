import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("Python smoke helper", () => {
  it("prevents bytecode cache output during smoke validation", async () => {
    const source = await readFile(path.join(ROOT, "scripts", "ci", "python-smoke.mjs"), "utf8");

    expect(source).toContain('PYTHONDONTWRITEBYTECODE: "1"');
    expect(source).toContain("env: pythonEnv");
  });
});
