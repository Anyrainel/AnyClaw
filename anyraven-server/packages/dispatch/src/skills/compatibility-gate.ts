import { parseSkillFile, isCompatible } from "./frontmatter.js";

export type GateResult =
  | { ok: true; checked: number }
  | { ok: false; error: string };

/**
 * Check all skills in the map for compatibility with the server.
 * Returns the first incompatibility found, or ok: true if all pass.
 *
 * @param skills Map of skill name -> raw file content (with frontmatter)
 * @param serverVersion Current server version (from package.json)
 * @param minSkillVersion Minimum skill version the server accepts
 */
export function checkSkillCompatibility(
  skills: Map<string, string>,
  serverVersion: string,
  minSkillVersion: string,
): GateResult {
  for (const [name, raw] of skills) {
    const parsed = parseSkillFile(raw);
    const compat = isCompatible(parsed.meta, serverVersion, minSkillVersion);
    if (!compat.ok) {
      return {
        ok: false,
        error: `Skill ${name} v${parsed.meta.skillVersion} is incompatible: ${compat.reason}`,
      };
    }
  }
  return { ok: true, checked: skills.size };
}
