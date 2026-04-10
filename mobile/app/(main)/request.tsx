import { useEffect } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useTaskStore } from "@/lib/tasks/store";
import { TaskInput } from "@/components/TaskInput";
import { TaskCard } from "@/components/TaskCard";

const SERVER_ID = "default";

export default function RequestScreen() {
  const activeTask = useTaskStore((s) => s.activeTask);
  const submitTask = useTaskStore((s) => s.submitTask);
  const answerQuestion = useTaskStore((s) => s.answerQuestion);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const retryTask = useTaskStore((s) => s.retryTask);
  const dismissTask = useTaskStore((s) => s.dismissTask);
  const resumeActiveTask = useTaskStore((s) => s.resumeActiveTask);

  // Resume active task on mount (handles app close/reopen mid-task)
  useEffect(() => {
    resumeActiveTask(SERVER_ID);
  }, []);

  const handleSubmit = (request: string) => {
    submitTask(request, SERVER_ID);
  };

  const handleAnswer = (answer: string) => {
    answerQuestion(answer, SERVER_ID);
  };

  const handleCancel = () => {
    cancelTask(SERVER_ID);
  };

  const handleRetry = () => {
    retryTask(SERVER_ID);
  };

  const handleDismiss = () => {
    dismissTask();
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="request-screen"
    >
      {!activeTask ? (
        <TaskInput onSubmit={handleSubmit} />
      ) : (
        <TaskCard
          task={activeTask}
          onAnswer={handleAnswer}
          onCancel={handleCancel}
          onRetry={handleRetry}
          onDismiss={handleDismiss}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  content: {
    flexGrow: 1,
    paddingVertical: 8,
  },
});
