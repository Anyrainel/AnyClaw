import semver from "semver";

export interface SkillMeta {
  skillVersion: string;
  minServerVersion: string;
}

export interface ParsedSkill {
  meta: SkillMeta;
  body: string;
}

/**
 * Parse a skill markdown file with YAML frontmatter.
 * Extracts skill_version and min_server_version from the frontmatter block
 * and returns the body with frontmatter stripped.
 */
export function parseSkillFile(raw: string): ParsedSkill {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    throw new Error(
      "Skill file is missing YAML frontmatter (must start with ---)",
    );
  }

  const secondDash = trimmed.indexOf("---", 3);
  if (secondDash === -1) {
    throw new Error(
      "Skill file has unclosed YAML frontmatter (missing closing ---)",
    );
  }

  const yamlBlock = trimmed.slice(3, secondDash).trim();
  const afterFrontmatter = trimmed.slice(secondDash + 3).trimStart();

  // Simple YAML key-value parser (sufficient for flat frontmatter)
  const pairs: Record<string, string> = {};
  for (const line of yamlBlock.split("\n")) {
    const match = line.match(/^(\w+)\s*:\s*"?([^"]*)"?\s*$/);
    if (match && match[1] && match[2]) {
      pairs[match[1]] = match[2];
    }
  }

  if (!pairs["skill_version"]) {
    throw new Error(
      "Skill frontmatter is missing required key: skill_version",
    );
  }
  if (!pairs["min_server_version"]) {
    throw new Error(
      "Skill frontmatter is missing required key: min_server_version",
    );
  }

  return {
    meta: {
      skillVersion: pairs["skill_version"],
      minServerVersion: pairs["min_server_version"],
    },
    body: afterFrontmatter,
  };
}

/**
 * Check whether a skill is compatible with the server.
 * Both directions are checked:
 * 1. skill.skillVersion >= minSkillVersion (server requires at least this skill version)
 * 2. serverVersion >= skill.minServerVersion (skill requires at least this server version)
 */
export function isCompatible(
  skill: SkillMeta,
  serverVersion: string,
  minSkillVersion: string,
): { ok: true } | { ok: false; reason: string } {
  // Validate all versions are valid semver
  if (!semver.valid(skill.skillVersion)) {
    throw new Error(
      `Invalid semver for skill version: "${skill.skillVersion}"`,
    );
  }
  if (!semver.valid(skill.minServerVersion)) {
    throw new Error(
      `Invalid semver for min_server_version: "${skill.minServerVersion}"`,
    );
  }
  if (!semver.valid(serverVersion)) {
    throw new Error(
      `Invalid semver for server version: "${serverVersion}"`,
    );
  }
  if (!semver.valid(minSkillVersion)) {
    throw new Error(
      `Invalid semver for min_skill_version: "${minSkillVersion}"`,
    );
  }

  // Check skill version meets server's minimum requirement
  if (semver.lt(skill.skillVersion, minSkillVersion)) {
    return {
      ok: false,
      reason: `Skill version ${skill.skillVersion} is below the server's minimum required skill version ${minSkillVersion}. Update the skill files.`,
    };
  }

  // Check server version meets skill's minimum requirement
  if (semver.lt(serverVersion, skill.minServerVersion)) {
    return {
      ok: false,
      reason: `Server version ${serverVersion} is below the skill's required minimum server version ${skill.minServerVersion}. Update the AnyRaven server.`,
    };
  }

  return { ok: true };
}
