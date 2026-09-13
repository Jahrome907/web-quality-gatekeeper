/* global console, process */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function verifyReleaseTag({ repository, tag, expectedCommit, expectedTagSha, api }) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
    !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag ?? "")
  ) {
    throw new Error("A repository and version tag are required.");
  }
  const endpoint = `repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`;
  const ref = api(endpoint);
  if (ref.object?.type !== "tag" || !/^[a-f0-9]{40}$/.test(ref.object.sha ?? "")) {
    throw new Error("Release requires a signed annotated tag; lightweight tags are not accepted.");
  }
  const signedTag = api(`repos/${repository}/git/tags/${ref.object.sha}`);
  if (
    signedTag.sha !== ref.object.sha ||
    signedTag.tag !== tag ||
    signedTag.verification?.verified !== true ||
    signedTag.verification.reason !== "valid"
  ) {
    throw new Error("Release tag must have a signature verified by GitHub.");
  }
  const commit = signedTag.object?.sha;
  if (signedTag.object?.type !== "commit" || !/^[a-f0-9]{40}$/.test(commit ?? "")) {
    throw new Error("Release tag must point directly to a commit.");
  }
  if (
    (expectedCommit && commit !== expectedCommit) ||
    (expectedTagSha && ref.object.sha !== expectedTagSha)
  ) {
    throw new Error("Release tag changed after validation.");
  }
  const current = api(endpoint);
  if (current.object?.type !== "tag" || current.object.sha !== ref.object.sha) {
    throw new Error("Release tag changed during signature verification.");
  }
  return { commit, tag_sha: ref.object.sha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyReleaseTag({
      repository: process.env.GITHUB_REPOSITORY,
      tag: process.env.RELEASE_TAG,
      expectedCommit: process.env.RELEASE_COMMIT,
      expectedTagSha: process.env.RELEASE_TAG_SHA,
      api: (endpoint) => JSON.parse(execFileSync("gh", ["api", endpoint], { encoding: "utf8" }))
    });
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        Object.entries(result)
          .map(([key, value]) => `${key}=${value}\n`)
          .join("")
      );
    }
    console.log(`Verified signed release tag ${process.env.RELEASE_TAG} at ${result.commit}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
