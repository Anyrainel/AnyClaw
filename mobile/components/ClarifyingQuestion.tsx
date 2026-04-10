import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";

interface ClarifyingQuestionProps {
  question: string;
  onAnswer: (answer: string) => void;
}

export function ClarifyingQuestion({
  question,
  onAnswer,
}: ClarifyingQuestionProps) {
  const [answer, setAnswer] = useState("");

  const handleSend = () => {
    const trimmed = answer.trim();
    if (!trimmed) return;
    onAnswer(trimmed);
    setAnswer("");
  };

  return (
    <View style={styles.container} testID="clarifying-question">
      <View style={styles.questionCard}>
        <Text style={styles.questionLabel}>Agent asks:</Text>
        <Text style={styles.questionText}>{question}</Text>
      </View>

      <TextInput
        style={styles.answerInput}
        placeholder="Type your answer..."
        placeholderTextColor="#9ca3af"
        value={answer}
        onChangeText={setAnswer}
        multiline
        testID="clarifying-answer-input"
      />

      <TouchableOpacity
        style={[styles.sendButton, !answer.trim() && styles.sendButtonDisabled]}
        onPress={handleSend}
        disabled={!answer.trim()}
        testID="clarifying-send"
      >
        <Text style={styles.sendText}>Send</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  questionCard: {
    backgroundColor: "#eff6ff",
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
  },
  questionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6366f1",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  questionText: {
    fontSize: 15,
    color: "#111",
    lineHeight: 22,
  },
  answerInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: "#111",
    minHeight: 80,
    backgroundColor: "#f9fafb",
    marginBottom: 12,
    textAlignVertical: "top",
  },
  sendButton: {
    backgroundColor: "#6366f1",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  sendButtonDisabled: {
    backgroundColor: "#c7d2fe",
  },
  sendText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
