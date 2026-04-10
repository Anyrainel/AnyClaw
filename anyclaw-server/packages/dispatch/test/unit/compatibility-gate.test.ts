import { describe, it, expect } from "vitest";
import { checkSkillCompatibility } from "../../src/skills/compatibility-gate.js";

const VALID_SKILL_RAW = `---
skill_version: "1.0.0"
min_server_version: "0.1.0"
---
# anyclaw-test-skill

Test skill content.
`;

const OLD_SKILL_RAW = `---
skill_version: "0.5.0"
min_server_version: "0.1.0"
---
# anyclaw-old-skill

Old skill content.
`;

const DEMANDING_SKILL_RAW = `---
skill_version: "1.0.0"
min_server_version: "9.0.0"
---
# anyclaw-demanding-skill

Demanding skill content.
`;

describe("checkSkillCompatibility", () => {
  it("passes when all skills are compatible", () => {
    const skills = new Map([
      ["anyclaw-build-feature", VALID_SKILL_RAW],
    ]);

    const result = checkSkillCompatibility(
      skills,
      "0.1.0",  // serverVersion
      "1.0.0",  // minSkillVersion
    );

    expect(result).toEqual({ ok: true, checked: 1 });
  });

  it("rejects when a skill version is below minSkillVersion", () => {
    const skills = new Map([
      ["anyclaw-old-skill", OLD_SKILL_RAW],
    ]);

    const result = checkSkillCompatibility(
      skills,
      "0.1.0",
      "1.0.0",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("anyclaw-old-skill");
      expect(result.error).toContain("0.5.0");
    }
  });

  it("rejects when server version is below skill's min_server_version", () => {
    const skills = new Map([
      ["anyclaw-demanding-skill", DEMANDING_SKILL_RAW],
    ]);

    const result = checkSkillCompatibility(
      skills,
      "0.1.0",
      "1.0.0",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("anyclaw-demanding-skill");
      expect(result.error).toContain("9.0.0");
    }
  });

  it("reports the name of the offending skill in the error", () => {
    const skills = new Map([
      ["anyclaw-build-feature", VALID_SKILL_RAW],
      ["anyclaw-old-skill", OLD_SKILL_RAW],
    ]);

    const result = checkSkillCompatibility(
      skills,
      "0.1.0",
      "1.0.0",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("anyclaw-old-skill");
      // Should NOT mention the compatible one
      expect(result.error).not.toContain("anyclaw-build-feature");
    }
  });

  it("checks multiple skills and reports first failure", () => {
    const skills = new Map([
      ["anyclaw-build-feature", VALID_SKILL_RAW],
      ["anyclaw-demanding-skill", DEMANDING_SKILL_RAW],
      ["anyclaw-old-skill", OLD_SKILL_RAW],
    ]);

    const result = checkSkillCompatibility(
      skills,
      "0.1.0",
      "1.0.0",
    );

    expect(result.ok).toBe(false);
  });
});
