import type { Server } from "node:http";
import { mkdir, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function loadCiShared(): Promise<{
  cleanupRepoRootNoise: (options?: {
    root?: string;
    scratchPrefixes?: string[];
    staleAfterMs?: number;
  }) => Promise<void>;
  closeFixtureServer: (server: Server) => Promise<void>;
  runChecked: (
    command: string,
    args: string[],
    options?: {
      env?: Record<string, string>;
      timeout?: number;
      cwd?: string;
    }
  ) => Promise<{ stdout: string; stderr: string }>;
  startFixtureServer: (
    directory?: string,
    options?: {
      port?: number;
    }
  ) => Promise<{ server: Server; url: string }>;
}> {
  // @ts-expect-error -- CI helper script is tested via its runtime ESM entrypoint.
  return import("../scripts/ci/_shared.mjs");
}

describe("ci shared helpers", () => {
  it("preserves inherited environment variables when extending env overrides", async () => {
    const { runChecked } = await loadCiShared();
    const originalValue = process.env.WQG_RUNCHECKED_PARENT;
    process.env.WQG_RUNCHECKED_PARENT = "parent-value";

    try {
      const { stdout } = await runChecked(
        "node",
        [
          "--input-type=module",
          "--eval",
          [
            "console.log(JSON.stringify({",
            "  parent: process.env.WQG_RUNCHECKED_PARENT,",
            "  child: process.env.WQG_RUNCHECKED_CHILD,",
            "  pathPresent: typeof process.env.PATH === 'string' && process.env.PATH.length > 0",
            "}));"
          ].join("\n")
        ],
        {
          env: {
            WQG_RUNCHECKED_CHILD: "child-value"
          }
        }
      );

      expect(JSON.parse(stdout)).toEqual({
        parent: "parent-value",
        child: "child-value",
        pathPresent: true
      });
    } finally {
      if (originalValue === undefined) {
        delete process.env.WQG_RUNCHECKED_PARENT;
      } else {
        process.env.WQG_RUNCHECKED_PARENT = originalValue;
      }
    }
  });

  it("allows callers to override the default command timeout", async () => {
    const { runChecked } = await loadCiShared();
    const startedAt = Date.now();

    const { stdout } = await runChecked(
      "node",
      [
        "--input-type=module",
        "--eval",
        'await new Promise((resolve) => setTimeout(resolve, 150)); console.log("done");'
      ],
      {
        timeout: 1000
      }
    );

    expect(stdout.trim()).toBe("done");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(125);
  });

  it("cleans only stale repo-root noise directories without touching fresh or unrelated folders", async () => {
    const { cleanupRepoRootNoise } = await loadCiShared();
    const staleTemp = path.join(process.cwd(), ".tmp-action-local-ci-shared-test");
    const freshTemp = path.join(process.cwd(), ".tmp-action-local-ci-shared-fresh");
    const otherScratch = path.join(process.cwd(), ".tmp-pack-smoke-ci-shared-test");
    const staleLeak = path.join(
      process.cwd(),
String.raw`\\wsl.localhost\Ubuntu\home\user\projects\web-quality-gatekeeper\undefined\Users\undefined\AppData\Local\lighthouse.12345678`
    );
    const unrelated = path.join(process.cwd(), ".tmp-kept-ci-shared-test");

    await mkdir(staleTemp, { recursive: true });
    await mkdir(freshTemp, { recursive: true });
    await mkdir(otherScratch, { recursive: true });
    await mkdir(staleLeak, { recursive: true });
    await mkdir(unrelated, { recursive: true });
    const staleTimestamp = new Date(Date.now() - 5_000);
    await utimes(staleTemp, staleTimestamp, staleTimestamp);
    await utimes(otherScratch, staleTimestamp, staleTimestamp);
    await utimes(staleLeak, staleTimestamp, staleTimestamp);
    await utimes(unrelated, staleTimestamp, staleTimestamp);

    try {
      await cleanupRepoRootNoise({
        scratchPrefixes: [".tmp-action-local-"],
        staleAfterMs: 1_000
      });

      await expect(stat(staleTemp)).rejects.toMatchObject({
        code: "ENOENT"
      });
      await expect(stat(freshTemp)).resolves.toBeDefined();
      await expect(stat(otherScratch)).resolves.toBeDefined();
      await expect(stat(staleLeak)).rejects.toMatchObject({
        code: "ENOENT"
      });
      await expect(stat(unrelated)).resolves.toBeDefined();
    } finally {
      await rm(freshTemp, { recursive: true, force: true });
      await rm(otherScratch, { recursive: true, force: true });
      await rm(unrelated, { recursive: true, force: true });
    }
  });

  it("keeps fixture server requests confined to the fixture root", async () => {
    const { closeFixtureServer, startFixtureServer } = await loadCiShared();
    const { server, url } = await startFixtureServer();

    try {
      const okResponse = await fetch(`${url}/index.html`);
      expect(okResponse.status).toBe(200);

      const traversalResponse = await fetch(`${url}/../../package.json`);
      expect(traversalResponse.status).toBe(404);
      await expect(traversalResponse.text()).resolves.toBe("Not Found");
    } finally {
      await closeFixtureServer(server);
    }
  });

  it("honors an explicit fixture server port", async () => {
    const { closeFixtureServer, startFixtureServer } = await loadCiShared();
    const { server, url } = await startFixtureServer(undefined, { port: 4017 });

    try {
      expect(url).toBe("http://127.0.0.1:4017");
    } finally {
      await closeFixtureServer(server);
    }
  });
});
