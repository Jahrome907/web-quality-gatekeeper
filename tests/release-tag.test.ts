import { describe, expect, it, vi } from "vitest";
import { verifyReleaseTag } from "../scripts/ci/verify-release-tag.mjs";

const commit = "a".repeat(40);
const tagSha = "b".repeat(40);
const otherSha = "c".repeat(40);

function fixture() {
  const ref = { object: { type: "tag", sha: tagSha } };
  const tag = {
    sha: tagSha,
    tag: "v4.0.1",
    object: { type: "commit", sha: commit },
    verification: { verified: true, reason: "valid" }
  };
  const api = vi.fn().mockReturnValueOnce(ref).mockReturnValueOnce(tag).mockReturnValueOnce(ref);
  const options = {
    repository: "owner/project",
    tag: "v4.0.1",
    expectedCommit: commit,
    expectedTagSha: tagSha,
    api
  };
  return { ref, tag, api, options };
}

describe("release tag signature gate", () => {
  it("accepts a verified annotated tag and returns its immutable identity", () => {
    const { options, api } = fixture();
    expect(verifyReleaseTag(options)).toEqual({ commit, tag_sha: tagSha });
    expect(api.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      "repos/owner/project/git/ref/tags/v4.0.1",
      `repos/owner/project/git/tags/${tagSha}`,
      "repos/owner/project/git/ref/tags/v4.0.1"
    ]);
  });

  it("rejects a lightweight tag even when its commit is signed", () => {
    const { ref, options } = fixture();
    ref.object.type = "commit";
    expect(() => verifyReleaseTag(options)).toThrow("signed annotated tag");
  });

  it.each(["unsigned", "unknown_key", "invalid", "gpgverify_unavailable"])(
    "rejects a tag with signature status %s",
    (reason) => {
      const { tag, options } = fixture();
      tag.verification = { verified: false, reason };
      expect(() => verifyReleaseTag(options)).toThrow("signature verified by GitHub");
    }
  );

  it("rejects missing signature metadata", () => {
    const { tag, options } = fixture();
    Reflect.deleteProperty(tag, "verification");
    expect(() => verifyReleaseTag(options)).toThrow("signature verified by GitHub");
  });

  it.each([1, 2, 3])("fails closed if API request %i fails", (request) => {
    const { ref, tag, options } = fixture();
    let calls = 0;
    options.api = vi.fn(() => {
      if (++calls === request) throw new Error("API unavailable");
      return calls === 2 ? tag : ref;
    });
    expect(() => verifyReleaseTag(options)).toThrow("API unavailable");
  });

  it("rejects a replacement tag object even when the commit is unchanged", () => {
    const { options } = fixture();
    options.expectedTagSha = otherSha;
    expect(() => verifyReleaseTag(options)).toThrow("changed after validation");
  });

  it("rejects a changed target commit", () => {
    const { options } = fixture();
    options.expectedCommit = otherSha;
    expect(() => verifyReleaseTag(options)).toThrow("changed after validation");
  });

  it("rejects a ref that changes while verification is in progress", () => {
    const { ref, tag, options } = fixture();
    options.api = vi
      .fn()
      .mockReturnValueOnce(ref)
      .mockReturnValueOnce(tag)
      .mockReturnValueOnce({ object: { type: "tag", sha: otherSha } });
    expect(() => verifyReleaseTag(options)).toThrow("changed during signature verification");
  });

  it("rejects nested annotated tags", () => {
    const { tag, options } = fixture();
    tag.object.type = "tag";
    expect(() => verifyReleaseTag(options)).toThrow("directly to a commit");
  });

  it.each(["tag", "sha"])("rejects a mismatched tag object %s", (field) => {
    const { tag, options } = fixture();
    Reflect.set(tag, field, "unexpected");
    expect(() => verifyReleaseTag(options)).toThrow("signature verified by GitHub");
  });

  it("rejects invalid input before calling GitHub", () => {
    const { options, api } = fixture();
    options.tag = "v4";
    expect(() => verifyReleaseTag(options)).toThrow("repository and version tag");
    expect(api).not.toHaveBeenCalled();
  });
});
