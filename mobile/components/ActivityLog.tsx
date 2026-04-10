import { View, Text, StyleSheet, ScrollView } from "react-native";
import { formatDistanceToNow } from "date-fns";
import type { QAEntry } from "@/lib/tasks/store";

interface ActivityLogProps {
  qaHistory: QAEntry[];
  request: string;
}

export function ActivityLog({ qaHistory, request }: ActivityLogProps) {
  // Show most recent 20 entries
  const entries = qaHistory.slice(-20);

  return (
    <ScrollView style={styles.container} testID="activity-log">
      <View style={styles.entry}>
        <Text style={styles.entryLabel}>Request</Text>
        <Text style={styles.entryText}>{request}</Text>
      </View>

      {entries.map((qa, index) => (
        <View key={index}>
          <View style={styles.entry}>
            <Text style={styles.agentLabel}>Agent asked</Text>
            <Text style={styles.entryText}>{qa.question}</Text>
          </View>
          <View style={styles.entry}>
            <Text style={styles.userLabel}>You answered</Text>
            <Text style={styles.entryText}>{qa.answer}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    maxHeight: 200,
    marginVertical: 8,
    paddingHorizontal: 16,
  },
  entry: {
    marginBottom: 10,
  },
  entryLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6b7280",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  agentLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6366f1",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  userLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#059669",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  entryText: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
  },
});
