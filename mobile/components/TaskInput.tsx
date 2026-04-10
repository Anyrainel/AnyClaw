import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";

interface TaskInputProps {
  onSubmit: (request: string) => void;
}

export function TaskInput({ onSubmit }: TaskInputProps) {
  const [text, setText] = useState("");

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText("");
  };

  return (
    <View style={styles.container} testID="task-input">
      <Text style={styles.label}>What would you like to build?</Text>
      <TextInput
        style={styles.input}
        placeholder="Describe your task..."
        placeholderTextColor="#9ca3af"
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        testID="task-input-field"
      />
      <TouchableOpacity
        style={[styles.submitButton, !text.trim() && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={!text.trim()}
        testID="task-submit"
      >
        <Text style={styles.submitText}>Submit</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  label: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111",
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: "#111",
    minHeight: 120,
    backgroundColor: "#f9fafb",
    marginBottom: 12,
  },
  submitButton: {
    backgroundColor: "#6366f1",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  submitButtonDisabled: {
    backgroundColor: "#c7d2fe",
  },
  submitText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
