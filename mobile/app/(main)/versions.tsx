import { useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { useVersionsStore, type Version } from "@/lib/versions/store";

function VersionRow({ version, isCurrent }: { version: Version; isCurrent: boolean }) {
  const rollbackTo = useVersionsStore((s) => s.rollbackTo);

  const handleRollback = () => {
    Alert.alert(
      "Rollback",
      `Are you sure you want to rollback to version "${version.label}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Rollback",
          style: "destructive",
          onPress: () => rollbackTo(version.id),
        },
      ]
    );
  };

  return (
    <View style={styles.row} testID={`version-row-${version.id}`}>
      <View style={styles.rowHeader}>
        <Text style={styles.label}>{version.label}</Text>
        {isCurrent && (
          <Text style={styles.currentBadge} testID="current-badge">
            Current
          </Text>
        )}
      </View>
      <Text style={styles.date}>
        {new Date(version.createdAt).toLocaleDateString()}
      </Text>
      {!isCurrent && (
        <TouchableOpacity
          style={styles.rollbackButton}
          onPress={handleRollback}
          testID={`rollback-${version.id}`}
        >
          <Text style={styles.rollbackText}>Rollback</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function VersionsScreen() {
  const versions = useVersionsStore((s) => s.versions);
  const isLoading = useVersionsStore((s) => s.isLoading);
  const error = useVersionsStore((s) => s.error);
  const fetchVersions = useVersionsStore((s) => s.fetchVersions);

  useEffect(() => {
    fetchVersions();
  }, []);

  if (isLoading) {
    return (
      <View style={styles.center} testID="versions-loading">
        <ActivityIndicator size="large" />
        <Text style={styles.statusText}>Loading versions...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center} testID="versions-error">
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchVersions} testID="versions-retry">
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={versions}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => (
        <VersionRow version={item} isCurrent={index === 0} />
      )}
      ListEmptyComponent={() => (
        <View style={styles.center} testID="versions-empty">
          <Text style={styles.statusText}>No versions deployed yet.</Text>
        </View>
      )}
      testID="versions-list"
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  row: {
    backgroundColor: "#fff",
    padding: 16,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  currentBadge: {
    marginLeft: 8,
    fontSize: 12,
    color: "#059669",
    fontWeight: "600",
    backgroundColor: "#d1fae5",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  date: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 8,
  },
  statusText: {
    fontSize: 15,
    color: "#6b7280",
    marginTop: 8,
  },
  errorText: {
    fontSize: 15,
    color: "#dc2626",
    textAlign: "center",
  },
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#3b82f6",
    borderRadius: 6,
  },
  retryText: {
    color: "#fff",
    fontWeight: "600",
  },
  rollbackButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#ef4444",
    borderRadius: 6,
  },
  rollbackText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
});
