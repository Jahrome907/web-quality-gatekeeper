import path from "node:path";
import type { BuiltinPolicyName } from "../config/policies.js";
import { ensureDir, pathExists, writeText } from "../utils/fs.js";
import {
  buildConsumerConfig,
  buildConsumerReadme,
  buildConsumerWorkflow
} from "./templates.js";

export type InitProfileName = BuiltinPolicyName;

export interface InitScaffoldOptions {
  profile: InitProfileName;
  cwd: string;
  force?: boolean;
}

export interface InitScaffoldResult {
  createdFiles: string[];
  profile: InitProfileName;
}

interface ScaffoldFile {
  relativePath: string;
  content: string;
}

function buildScaffoldFiles(profile: InitProfileName): ScaffoldFile[] {
  return [
    {
      relativePath: ".github/web-quality/config.json",
      content: buildConsumerConfig(profile)
    },
    {
      relativePath: ".github/workflows/web-quality.yml",
      content: buildConsumerWorkflow()
    },
    {
      relativePath: ".github/web-quality/baselines/.gitkeep",
      content: ""
    },
    {
      relativePath: ".github/web-quality/README.md",
      content: buildConsumerReadme(profile)
    }
  ];
}

export async function scaffoldConsumerProject(
  options: InitScaffoldOptions
): Promise<InitScaffoldResult> {
  const root = path.resolve(options.cwd);
  const files = buildScaffoldFiles(options.profile);
  const existingFiles: string[] = [];

  for (const file of files) {
    const absolutePath = path.join(root, file.relativePath);
    if (!options.force && (await pathExists(absolutePath))) {
      existingFiles.push(file.relativePath);
    }
  }

  if (existingFiles.length > 0) {
    throw new Error(
      `Refusing to overwrite existing web-quality files: ${existingFiles.join(", ")}. Re-run with --force to replace them.`
    );
  }

  for (const file of files) {
    const absolutePath = path.join(root, file.relativePath);
    await ensureDir(path.dirname(absolutePath));
    await writeText(absolutePath, file.content);
  }

  return {
    createdFiles: files.map((file) => file.relativePath),
    profile: options.profile
  };
}
