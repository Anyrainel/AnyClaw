import { useEffect, useRef } from "react";
import { Slot, useRootNavigationState, useRouter, useSegments } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { resolveRoute } from "@/lib/auth-gate";
import { registerForPushNotifications, resolveNotificationRoute } from "@/lib/push";
import { useConnectionStore } from "@/lib/connection/store";

export default function RootLayout() {
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const isConnected = useConnectionStore((s) => s.isConnected);
  const pushRegistered = useRef(false);

  useEffect(() => {
    if (!navigationState?.key) return;

    // TODO: Replace with actual store state once stores are wired
    const isAuthenticated = false;
    const isConnectedLocal = false;
    const onboardingComplete = false;

    const redirect = resolveRoute({
      isAuthenticated,
      isConnected: isConnectedLocal,
      onboardingComplete,
      segments: segments as string[],
    });

    if (redirect) {
      router.replace(redirect as never);
    }
  }, [segments, navigationState?.key]);

  // Register push notifications when connected
  useEffect(() => {
    if (isConnected && !pushRegistered.current) {
      pushRegistered.current = true;
      registerForPushNotifications().catch(() => {
        // Best-effort — permission denied or network failure
      });
    }
  }, [isConnected]);

  // Listen for notification taps and route accordingly
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as Record<
          string,
          unknown
        >;
        const route = resolveNotificationRoute(data);
        if (route) {
          router.push(route as never);
        }
      }
    );

    return () => subscription.remove();
  }, [router]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Slot />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
