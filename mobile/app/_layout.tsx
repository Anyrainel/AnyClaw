import { useEffect } from "react";
import { Slot, useRootNavigationState, useRouter, useSegments } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { resolveRoute } from "@/lib/auth-gate";

export default function RootLayout() {
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();

  useEffect(() => {
    if (!navigationState?.key) return;

    // TODO: Replace with actual store state once stores are wired
    const isAuthenticated = false;
    const isConnected = false;
    const onboardingComplete = false;

    const redirect = resolveRoute({
      isAuthenticated,
      isConnected,
      onboardingComplete,
      segments: segments as string[],
    });

    if (redirect) {
      router.replace(redirect as never);
    }
  }, [segments, navigationState?.key]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Slot />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
