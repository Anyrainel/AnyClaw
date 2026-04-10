export interface AuthGateInput {
  isAuthenticated: boolean;
  isConnected: boolean;
  onboardingComplete: boolean;
  segments: string[];
}

/**
 * Pure function that determines the redirect target based on auth/connection state.
 * Returns a route path string to redirect to, or null to stay on the current route.
 */
export function resolveRoute(input: AuthGateInput): string | null {
  const { isAuthenticated, isConnected, onboardingComplete, segments } = input;
  const inAuth = segments[0] === "(auth)";
  const inOnboarding = segments[0] === "(onboarding)";
  const inMain = segments[0] === "(main)";

  // Not authenticated -> must go to login
  if (!isAuthenticated) {
    if (inAuth) return null;
    return "/(auth)/login";
  }

  // Authenticated but onboarding not done
  if (!onboardingComplete) {
    if (inOnboarding) return null;
    return "/(onboarding)/welcome";
  }

  // Authenticated + onboarded but not connected to a server
  if (!isConnected) {
    if (inAuth) return null;
    return "/(auth)/server-list";
  }

  // Fully ready — redirect away from auth/onboarding into main
  if (inAuth || inOnboarding) {
    return "/(main)";
  }

  return null;
}
