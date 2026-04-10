import { useRef, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useRouter } from "expo-router";
import { useConnectionStore } from "@/lib/connection/store";
import { usePreferencesStore } from "@/lib/preferences/store";
import { useVersionsStore } from "@/lib/versions/store";
import {
  parseBridgeMessage,
  buildResolvedPreferencesPayload,
  inject,
} from "@/lib/bridge";
import { subscribeToDeployments } from "@/lib/pocketbase";
import { refreshBrokerJwt } from "@/lib/broker";

type ScreenState = "loading" | "ready" | "error" | "app-broken";

export default function HomeScreen() {
  const router = useRouter();
  const webviewRef = useRef<WebView>(null);
  const [screenState, setScreenState] = useState<ScreenState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const sessionToken = useConnectionStore((s) => s.sessionToken);
  const connectionState = useConnectionStore((s) => s.connectionState);
  const prefs = usePreferencesStore((s) => s.prefs);
  const resolvedTheme = usePreferencesStore((s) => s.resolvedTheme);
  const resolvedFontScale = usePreferencesStore((s) => s.resolvedFontScale);

  // Subscribe to deployments
  useEffect(() => {
    let unsub: (() => Promise<void>) | null = null;

    const subscribe = async () => {
      try {
        unsub = await subscribeToDeployments(() => {
          // Reload WebView on new deployment
          webviewRef.current?.reload();
          useVersionsStore.getState().fetchVersions();
        }, "default");
      } catch {
        // Best-effort subscription
      }
    };

    subscribe();

    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Push preference updates to the WebView
  useEffect(() => {
    if (screenState !== "ready") return;
    const payload = buildResolvedPreferencesPayload(
      prefs,
      resolvedTheme,
      resolvedFontScale
    );
    inject(webviewRef as React.RefObject<{ postMessage: (msg: string) => void }>, {
      type: "preferences-update",
      preferences: payload,
    });
  }, [prefs, resolvedTheme, resolvedFontScale, screenState]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const msg = parseBridgeMessage(event.nativeEvent.data);
      if (!msg) return;

      if (msg.type === "ready") {
        setScreenState("ready");
        // Send session token
        if (sessionToken) {
          inject(webviewRef as React.RefObject<{ postMessage: (msg: string) => void }>, {
            type: "session-token",
            token: sessionToken,
          });
        }
        // Send preferences
        const payload = buildResolvedPreferencesPayload(
          prefs,
          resolvedTheme,
          resolvedFontScale
        );
        inject(webviewRef as React.RefObject<{ postMessage: (msg: string) => void }>, {
          type: "preferences-update",
          preferences: payload,
        });
      }
    },
    [sessionToken, prefs, resolvedTheme, resolvedFontScale]
  );

  const handleError = useCallback(() => {
    setScreenState("error");
    setErrorMessage("Could not reach the server. Check your connection.");
  }, []);

  const handleHttpError = useCallback(
    async (event: { nativeEvent: { statusCode: number } }) => {
      const status = event.nativeEvent.statusCode;
      if (status === 401) {
        // Silent JWT refresh then reload
        try {
          await refreshBrokerJwt();
          webviewRef.current?.reload();
        } catch {
          setScreenState("error");
          setErrorMessage("Session expired. Please log in again.");
        }
      } else if (status >= 500) {
        setScreenState("app-broken");
      }
    },
    []
  );

  const handleRetry = () => {
    setScreenState("loading");
    setErrorMessage(null);
    webviewRef.current?.reload();
  };

  const handleRollback = () => {
    router.push("/(main)/versions" as never);
  };

  const webviewUrl = serverUrl ? `${serverUrl}/app/` : null;

  // Error screen: server unreachable
  if (screenState === "error") {
    return (
      <View style={styles.centered} testID="home-error">
        <Text style={styles.errorTitle}>Connection Lost</Text>
        <Text style={styles.errorMessage}>
          {errorMessage ?? "Unable to reach the server."}
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={handleRetry}>
          <Text style={styles.primaryButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={handleRollback}>
          <Text style={styles.secondaryButtonText}>Rollback</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // App broken screen (5xx)
  if (screenState === "app-broken") {
    return (
      <View style={styles.centered} testID="home-broken">
        <Text style={styles.errorTitle}>App Error</Text>
        <Text style={styles.errorMessage}>
          The deployed app has an error. Try rolling back to a previous version.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={handleRollback}>
          <Text style={styles.primaryButtonText}>Open Version History</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={handleRetry}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // No server URL
  if (!webviewUrl) {
    return (
      <View style={styles.centered} testID="home-no-server">
        <Text style={styles.errorTitle}>Not Connected</Text>
        <Text style={styles.errorMessage}>No server is connected.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="home-webview">
      {/* Connection status badge */}
      {connectionState === "reconnecting" && (
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>Reconnecting...</Text>
        </View>
      )}

      {screenState === "loading" && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      )}

      <WebView
        ref={webviewRef}
        source={{ uri: webviewUrl }}
        style={styles.webview}
        onMessage={handleMessage}
        onError={handleError}
        onHttpError={handleHttpError}
        onRenderProcessGone={handleRetry}
        onContentProcessDidTerminate={handleRetry}
        onLoad={() => {
          if (screenState === "loading") {
            // Wait for bridge-ready message before setting ready
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
    zIndex: 10,
  },
  statusBadge: {
    backgroundColor: "#fbbf24",
    paddingVertical: 4,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#92400e",
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111",
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  primaryButton: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    backgroundColor: "#6366f1",
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 12,
    minWidth: 200,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 32,
  },
  secondaryButtonText: {
    color: "#6366f1",
    fontSize: 14,
    fontWeight: "600",
  },
});
