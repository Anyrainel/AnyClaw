import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { fetchServers, establishTunnel } from "@/lib/broker";
import { useConnectionStore } from "@/lib/connection/store";
import { apiClient } from "@/lib/api";
import { initPocketBase } from "@/lib/pocketbase";

interface Server {
  id: string;
  name: string;
}

export default function ServerListScreen() {
  const router = useRouter();
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchServers();
      setServers(result.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load servers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const handleConnect = async (server: Server) => {
    setConnecting(server.id);
    try {
      const tunnel = await establishTunnel(server.id);

      // Store session info
      await SecureStore.setItemAsync("session_token", tunnel.sessionToken);
      await SecureStore.setItemAsync("server_url", tunnel.relayUrl);

      // Configure API client
      apiClient.configure({
        baseUrl: tunnel.relayUrl,
        sessionToken: tunnel.sessionToken,
        serverId: server.id,
      });

      // Initialize PocketBase
      initPocketBase(tunnel.relayUrl, tunnel.pbAuthToken, server.id);

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
      Alert.alert(
        "Connection Failed",
        err instanceof Error ? err.message : "Could not connect to server"
      );
    } finally {
      setConnecting(null);
    }
  };

  const handleAddServer = () => {
    router.push("/(auth)/pair" as never);
  };

  if (loading) {
    return (
      <View style={styles.centered} testID="server-list-loading">
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Loading servers...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered} testID="server-list-error">
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadServers}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (servers.length === 0) {
    return (
      <View style={styles.centered} testID="server-list-empty">
        <Text style={styles.emptyTitle}>No Servers</Text>
        <Text style={styles.emptySubtitle}>
          Install AnyClaw on your server, then pair it here.
        </Text>
        <TouchableOpacity style={styles.addButton} onPress={handleAddServer}>
          <Text style={styles.addButtonText}>Add Server</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="server-list">
      <Text style={styles.heading}>Your Servers</Text>
      <FlatList
        data={servers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.serverRow}
            onPress={() => handleConnect(item)}
            disabled={connecting !== null}
            testID={`server-${item.id}`}
          >
            <Text style={styles.serverName}>{item.name}</Text>
            {connecting === item.id ? (
              <ActivityIndicator size="small" color="#6366f1" />
            ) : (
              <Text style={styles.connectText}>Connect</Text>
            )}
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
      <TouchableOpacity
        style={styles.addButton}
        onPress={handleAddServer}
        testID="add-server"
      >
        <Text style={styles.addButtonText}>Add Server</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 24,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111",
    marginBottom: 16,
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
  },
  retryText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
  },
  serverRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "#f9fafb",
    borderRadius: 8,
  },
  serverName: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111",
  },
  connectText: {
    fontSize: 14,
    color: "#6366f1",
    fontWeight: "600",
  },
  separator: {
    height: 8,
  },
  addButton: {
    marginTop: 24,
    paddingVertical: 14,
    backgroundColor: "#6366f1",
    borderRadius: 10,
    alignItems: "center",
  },
  addButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
