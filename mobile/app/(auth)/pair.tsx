import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";
import {
  initCrypto,
  generatePairingKeypair,
  verificationCode,
} from "@/lib/crypto";
import { storePairingKeys } from "@/lib/crypto-storage";
import { requestPairing, establishTunnel } from "@/lib/broker";
import { useConnectionStore } from "@/lib/connection/store";
import { apiClient } from "@/lib/api";
import { initPocketBase } from "@/lib/pocketbase";

type PairState = "loading" | "verify" | "confirming" | "error";

export default function PairScreen() {
  const router = useRouter();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const [state, setState] = useState<PairState>("loading");
  const [words, setWords] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pairingData, setPairingData] = useState<{
    clientPk: Uint8Array;
    clientSk: Uint8Array;
    serverPk: Uint8Array;
  } | null>(null);

  useEffect(() => {
    startPairing();
  }, []);

  const startPairing = async () => {
    setState("loading");
    setError(null);
    try {
      await initCrypto();
      const keypair = generatePairingKeypair();
      const result = await requestPairing(
        serverId ?? "",
        keypair.publicKey
      );

      const code = verificationCode(
        keypair.publicKey,
        result.serverPublicKey
      );

      setPairingData({
        clientPk: keypair.publicKey,
        clientSk: keypair.secretKey,
        serverPk: result.serverPublicKey,
      });
      setWords(code);
      setState("verify");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed");
      setState("error");
    }
  };

  const handleConfirm = async () => {
    if (!pairingData || !serverId) return;
    setState("confirming");
    try {
      // Store pairing keys
      await storePairingKeys(serverId, {
        publicKey: pairingData.clientPk,
        secretKey: pairingData.clientSk,
        serverPublicKey: pairingData.serverPk,
      });

      // Establish tunnel
      const tunnel = await establishTunnel(serverId);

      // Persist session
      await SecureStore.setItemAsync("session_token", tunnel.sessionToken);
      await SecureStore.setItemAsync("server_url", tunnel.relayUrl);

      // Configure API client
      apiClient.configure({
        baseUrl: tunnel.relayUrl,
        sessionToken: tunnel.sessionToken,
        serverId,
      });

      // Initialize PocketBase
      initPocketBase(tunnel.relayUrl, tunnel.pbAuthToken, serverId);

      // Update connection store
      useConnectionStore.setState({
        isConnected: true,
        serverUrl: tunnel.relayUrl,
        sessionToken: tunnel.sessionToken,
        pbAuthToken: tunnel.pbAuthToken,
        connectionState: "connected",
      });

      router.replace("/(main)" as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setState("error");
    }
  };

  const handleCancel = () => {
    router.back();
  };

  if (state === "loading") {
    return (
      <View style={styles.centered} testID="pair-loading">
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Starting pairing...</Text>
      </View>
    );
  }

  if (state === "error") {
    return (
      <View style={styles.centered} testID="pair-error">
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={startPairing}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelLink} onPress={handleCancel}>
          <Text style={styles.cancelLinkText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (state === "confirming") {
    return (
      <View style={styles.centered} testID="pair-confirming">
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Establishing connection...</Text>
      </View>
    );
  }

  // state === "verify"
  return (
    <View style={styles.container} testID="pair-verify">
      <Text style={styles.title}>Verify Pairing</Text>
      <Text style={styles.description}>
        Check that the following words match what your server is showing:
      </Text>

      <View style={styles.wordGrid}>
        {words.map((word, index) => (
          <View key={index} style={styles.wordCard}>
            <Text style={styles.wordNumber}>{index + 1}</Text>
            <Text style={styles.wordText}>{word}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.hint}>
        If these words do not match, cancel and try again.
      </Text>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={handleCancel}
          testID="pair-cancel"
        >
          <Text style={styles.cancelButtonText}>No, cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.confirmButton}
          onPress={handleConfirm}
          testID="pair-confirm"
        >
          <Text style={styles.confirmButtonText}>Yes, they match</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: "#fff",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111",
    textAlign: "center",
    marginTop: 32,
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 22,
  },
  wordGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 12,
    marginBottom: 24,
  },
  wordCard: {
    width: "45%",
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    alignItems: "center",
  },
  wordNumber: {
    fontSize: 12,
    color: "#9ca3af",
    fontWeight: "600",
    marginBottom: 4,
  },
  wordText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111",
  },
  hint: {
    fontSize: 13,
    color: "#9ca3af",
    textAlign: "center",
    marginBottom: 32,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#666",
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: "#6366f1",
    borderRadius: 10,
    alignItems: "center",
  },
  confirmButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  errorText: {
    fontSize: 16,
    color: "#dc2626",
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: "#6366f1",
    borderRadius: 8,
    marginBottom: 12,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  cancelLink: {
    paddingVertical: 8,
  },
  cancelLinkText: {
    color: "#6366f1",
    fontSize: 14,
  },
});
