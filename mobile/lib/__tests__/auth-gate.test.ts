import { resolveRoute } from "../auth-gate";

describe("resolveRoute", () => {
  test("unauthenticated + not in (auth) -> /(auth)/login", () => {
    const result = resolveRoute({
      isAuthenticated: false,
      isConnected: false,
      onboardingComplete: false,
      segments: ["(main)"],
    });
    expect(result).toBe("/(auth)/login");
  });

  test("authenticated + onboarding incomplete + not in (onboarding) -> /(onboarding)/welcome", () => {
    const result = resolveRoute({
      isAuthenticated: true,
      isConnected: false,
      onboardingComplete: false,
      segments: ["(main)"],
    });
    expect(result).toBe("/(onboarding)/welcome");
  });

  test("authenticated + onboarding complete + not connected + not in (auth) -> /(auth)/server-list", () => {
    const result = resolveRoute({
      isAuthenticated: true,
      isConnected: false,
      onboardingComplete: true,
      segments: ["(main)"],
    });
    expect(result).toBe("/(auth)/server-list");
  });

  test("fully ready + currently in (auth) -> /(main)", () => {
    const result = resolveRoute({
      isAuthenticated: true,
      isConnected: true,
      onboardingComplete: true,
      segments: ["(auth)", "login"],
    });
    expect(result).toBe("/(main)");
  });

  test("fully ready + in (main) -> null (stay)", () => {
    const result = resolveRoute({
      isAuthenticated: true,
      isConnected: true,
      onboardingComplete: true,
      segments: ["(main)"],
    });
    expect(result).toBeNull();
  });

  test("authenticated + onboarding complete + not connected + already in (auth) -> null", () => {
    const result = resolveRoute({
      isAuthenticated: true,
      isConnected: false,
      onboardingComplete: true,
      segments: ["(auth)", "server-list"],
    });
    expect(result).toBeNull();
  });
});
