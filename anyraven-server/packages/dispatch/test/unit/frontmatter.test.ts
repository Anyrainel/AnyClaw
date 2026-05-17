import { describe, it, expect } from "vitest";
import { parseSkillFile, isCompatible } from "../../src/skills/frontmatter.js";

const VALID_SKILL = `---
skill_version: "1.0.0"
min_server_version: "0.1.0"
---
# anyraven-build-feature

You are building a feature...
`;

describe("parseSkillFile", () => {
  it("extracts skill_version and min_server_version from valid YAML frontmatter", () => {
    const result = parseSkillFile(VALID_SKILL);
    expect(result.meta.skillVersion).toBe("1.0.0");
    expect(result.meta.minServerVersion).toBe("0.1.0");
  });

  it("strips frontmatter from body — body starts at first heading", () => {
    const result = parseSkillFile(VALID_SKILL);
    expect(result.body).not.toContain("---");
    expect(result.body).not.toContain("skill_version");
    expect(result.body.startsWith("# anyraven-build-feature")).toBe(true);
  });

  it("throws with a clear message when frontmatter is missing", () => {
    const noFrontmatter = "# anyraven-build-feature\n\nSome content.";
    expect(() => parseSkillFile(noFrontmatter)).toThrowError(/frontmatter/i);
  });

  it("throws when required key skill_version is missing", () => {
    const missingSkillVersion = `---
min_server_version: "0.1.0"
---
# anyraven-build-feature
`;
    expect(() => parseSkillFile(missingSkillVersion)).toThrowError(/skill_version/i);
  });

  it("throws when required key min_server_version is missing", () => {
    const missingMinServer = `---
skill_version: "1.0.0"
---
# anyraven-build-feature
`;
    expect(() => parseSkillFile(missingMinServer)).toThrowError(/min_server_version/i);
  });
});

describe("isCompatible", () => {
  it("returns ok: true when both directions satisfy", () => {
    const result = isCompatible(
      { skillVersion: "1.0.0", minServerVersion: "0.1.0" },
      "0.1.0",  // serverVersion
      "1.0.0",  // minSkillVersion
    );
    expect(result).toEqual({ ok: true });
  });

  it("returns ok: false + reason when skill.skillVersion < minSkillVersion", () => {
    const result = isCompatible(
      { skillVersion: "0.9.0", minServerVersion: "0.1.0" },
      "0.1.0",  // serverVersion
      "1.0.0",  // minSkillVersion
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("0.9.0");
      expect(result.reason).toContain("1.0.0");
    }
  });

  it("returns ok: false + reason when serverVersion < skill.minServerVersion", () => {
    const result = isCompatible(
      { skillVersion: "1.0.0", minServerVersion: "2.0.0" },
      "0.1.0",  // serverVersion
      "1.0.0",  // minSkillVersion
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("2.0.0");
      expect(result.reason).toContain("0.1.0");
    }
  });

  it("handles patch-level differences correctly (1.0.5 >= 1.0.0)", () => {
    const result = isCompatible(
      { skillVersion: "1.0.5", minServerVersion: "0.1.0" },
      "0.1.0",
      "1.0.0",
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects invalid semver with a clear error", () => {
    expect(() =>
      isCompatible(
        { skillVersion: "not-a-version", minServerVersion: "0.1.0" },
        "0.1.0",
        "1.0.0",
      ),
    ).toThrowError(/invalid.*semver/i);
  });

  it("rejects invalid server version", () => {
    expect(() =>
      isCompatible(
        { skillVersion: "1.0.0", minServerVersion: "0.1.0" },
        "bad",
        "1.0.0",
      ),
    ).toThrowError(/invalid.*semver/i);
  });
});
