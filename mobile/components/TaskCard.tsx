import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import type { ActiveTask } from "@/lib/tasks/store";
import { ClarifyingQuestion } from "./ClarifyingQuestion";
import { ActivityLog } from "./ActivityLog";

interface TaskCardProps {
  task: ActiveTask;
  onAnswer: (answer: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}

export function TaskCard({
  task,
  onAnswer,
  onCancel,
  onRetry,
  onDismiss,
}: TaskCardProps) {
  return (
    <View style={styles.card} testID="task-card">
      {/* Clarifying state */}
      {task.state === "clarifying" && task.question && (
        <View testID="task-clarifying">
          <ActivityLog qaHistory={task.qaHistory} request={task.request} />
          <ClarifyingQuestion question={task.question} onAnswer={onAnswer} />
        </View>
      )}

      {/* Queued / working state */}
      {(task.state === "queued" || task.state === "working") && (
        <View
          style={styles.stateContainer}
          testID={task.state === "queued" ? "task-queued" : "task-working"}
        >
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.stateTitle}>
            {task.state === "queued" ? "Queued..." : "Working..."}
          </Text>
          <Text style={styles.stateDescription}>
            {task.state === "queued"
              ? "Your request is waiting for the agent."
              : "The agent is working on your request."}
          </Text>
          <ActivityLog qaHistory={task.qaHistory} request={task.request} />
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onCancel}
            testID="task-cancel"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Deploying state */}
      {task.state === "deploying" && (
        <View style={styles.stateContainer} testID="task-deploying">
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.stateTitle}>Deploying...</Text>
          <Text style={styles.stateDescription}>
            Your changes are being deployed.
          </Text>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onCancel}
            testID="task-cancel-deploy"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Done state */}
      {task.state === "done" && (
        <View style={styles.stateContainer} testID="task-done">
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.stateTitle}>Done!</Text>
          <Text style={styles.stateDescription}>
            Your task has been completed and deployed.
          </Text>
          <TouchableOpacity
            style={styles.dismissButton}
            onPress={onDismiss}
            testID="task-dismiss"
          >
            <Text style={styles.dismissText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Failed state */}
      {task.state === "failed" && (
        <View style={styles.stateContainer} testID="task-failed">
          <Text style={styles.failIcon}>!</Text>
          <Text style={styles.stateTitle}>Failed</Text>
          <Text style={styles.errorMessage}>
            {task.error ?? "An unknown error occurred."}
          </Text>
          <View style={styles.failActions}>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={onRetry}
              testID="task-retry"
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dismissButton}
              onPress={onDismiss}
              testID="task-dismiss-fail"
            >
              <Text style={styles.dismissText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Input state (submitting) */}
      {task.state === "input" && (
        <View style={styles.stateContainer} testID="task-input-state">
          <ActivityIndicator size="small" color="#6366f1" />
          <Text style={styles.stateDescription}>Submitting...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    overflow: "hidden",
  },
  stateContainer: {
    alignItems: "center",
    padding: 24,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111",
    marginTop: 12,
    marginBottom: 6,
  },
  stateDescription: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 16,
  },
  successIcon: {
    fontSize: 40,
    color: "#059669",
  },
  failIcon: {
    fontSize: 40,
    fontWeight: "700",
    color: "#dc2626",
  },
  errorMessage: {
    fontSize: 14,
    color: "#dc2626",
    textAlign: "center",
    marginBottom: 16,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    marginTop: 8,
  },
  cancelText: {
    color: "#666",
    fontSize: 14,
    fontWeight: "600",
  },
  failActions: {
    flexDirection: "row",
    gap: 12,
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: "#6366f1",
    borderRadius: 8,
  },
  retryText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  dismissButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
  },
  dismissText: {
    color: "#666",
    fontSize: 14,
    fontWeight: "600",
  },
});
