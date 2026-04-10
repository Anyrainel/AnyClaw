import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { loginWithProvider } from "@/lib/broker";
import { useConnectionStore } from "@/lib/connection/store";

type Provider = "google" | "apple" | "github";

export default function LoginScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState<Provider | null>(null);

  const handleLogin = async (provider: Provider) => {
    setLoading(provider);
    try {
      await loginWithProvider(provider);
      useConnectionStore.setState({ isAuthenticated: true });
      // Auth gate will handle navigation
      router.replace("/(auth)/server-list" as never);
    } catch (err) {
      Alert.alert(
        "Login Failed",
        err instanceof Error ? err.message : "An error occurred"
      );
    } finally {
      setLoading(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>AnyClaw</Text>
        <Text style={styles.subtitle}>Sign in to get started</Text>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.googleButton]}
          onPress={() => handleLogin("google")}
          disabled={loading !== null}
          testID="login-google"
        >
          {loading === "google" ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Continue with Google</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.appleButton]}
          onPress={() => handleLogin("apple")}
          disabled={loading !== null}
          testID="login-apple"
        >
          {loading === "apple" ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Continue with Apple</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.githubButton]}
          onPress={() => handleLogin("github")}
          disabled={loading !== null}
          testID="login-github"
        >
          {loading === "github" ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Continue with GitHub</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  header: {
    alignItems: "center",
    marginBottom: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: "#111",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
  },
  buttons: {
    width: "100%",
    gap: 12,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  googleButton: {
    backgroundColor: "#4285F4",
  },
  appleButton: {
    backgroundColor: "#000",
  },
  githubButton: {
    backgroundColor: "#333",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
