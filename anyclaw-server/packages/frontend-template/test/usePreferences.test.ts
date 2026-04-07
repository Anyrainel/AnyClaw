import { describe, it, expect } from "vitest";
import { usePreferences } from "../src/lib/usePreferences.js";

describe("usePreferences (scaffold)", () => {
  it("returns the expected shape with defaults", () => {
    const result = usePreferences();
    expect(result.loading).toBe(false);
    expect(result.error).toBeNull();
    expect(result.preferences.theme).toBe("system");
    expect(result.preferences.locale).toBe("en-US");
  });
});
