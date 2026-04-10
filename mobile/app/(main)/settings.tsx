import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { usePreferencesStore } from "@/lib/preferences/store";
import { useSettingsStore, type ClarificationMode } from "@/lib/settings/store";
import { useConnectionStore } from "@/lib/connection/store";
import type {
  ThemeSetting,
  FontSizeSetting,
  FontFamilySetting,
} from "@/lib/preferences/types";

const THEME_OPTIONS: { label: string; value: ThemeSetting }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const FONT_SIZE_OPTIONS: { label: string; value: FontSizeSetting }[] = [
  { label: "System", value: "system" },
  { label: "Small", value: "small" },
  { label: "Medium", value: "medium" },
  { label: "Large", value: "large" },
];

const FONT_FAMILY_OPTIONS: { label: string; value: FontFamilySetting }[] = [
  { label: "Sans", value: "sans" },
  { label: "Serif", value: "serif" },
];

const ACCENT_COLORS = [
  { label: "Blue", value: "#3b82f6", style: { backgroundColor: "#3b82f6" } },
  { label: "Teal", value: "#14b8a6", style: { backgroundColor: "#14b8a6" } },
  { label: "Green", value: "#22c55e", style: { backgroundColor: "#22c55e" } },
  { label: "Amber", value: "#f59e0b", style: { backgroundColor: "#f59e0b" } },
  { label: "Rose", value: "#f43f5e", style: { backgroundColor: "#f43f5e" } },
  { label: "Violet", value: "#8b5cf6", style: { backgroundColor: "#8b5cf6" } },
] as const satisfies ReadonlyArray<{ label: string; value: string; style: import("react-native").ViewStyle }>;

const CLARIFICATION_MODE_OPTIONS: { label: string; value: ClarificationMode }[] = [
  { label: "Auto-timeout", value: "auto-timeout" },
  { label: "Pause indefinitely", value: "pause-indefinitely" },
];

const TIMEOUT_OPTIONS = [3, 5, 10, 15, 30];

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function OptionRow<T extends string>({
  options,
  selected,
  onSelect,
  testIDPrefix,
}: {
  options: { label: string; value: T }[];
  selected: T;
  onSelect: (value: T) => void;
  testIDPrefix: string;
}) {
  return (
    <View style={styles.optionRow}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[
            styles.optionPill,
            selected === opt.value && styles.optionPillSelected,
          ]}
          onPress={() => onSelect(opt.value)}
          testID={`${testIDPrefix}-${opt.value}`}
        >
          <Text
            style={[
              styles.optionPillText,
              selected === opt.value && styles.optionPillTextSelected,
            ]}
          >
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();

  // Preferences store
  const prefs = usePreferencesStore((s) => s.prefs);
  const setPref = usePreferencesStore((s) => s.set);

  // Settings store
  const clarificationMode = useSettingsStore((s) => s.clarificationMode);
  const clarificationTimeoutMinutes = useSettingsStore(
    (s) => s.clarificationTimeoutMinutes
  );
  const debugEncryptedTraffic = useSettingsStore(
    (s) => s.debugEncryptedTraffic
  );
  const updateSettings = useSettingsStore((s) => s.update);

  // Connection store
  const connectionState = useConnectionStore((s) => s.connectionState);
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const logout = useConnectionStore((s) => s.logout);

  const handleDisconnect = () => {
    Alert.alert("Disconnect", "Are you sure you want to disconnect?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/(auth)/login" as never);
        },
      },
    ]);
  };

  const handleRepair = () => {
    router.push("/(auth)/pair" as never);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="settings-screen"
    >
      {/* Theme */}
      <SectionHeader title="Theme" />
      <OptionRow
        options={THEME_OPTIONS}
        selected={prefs.theme}
        onSelect={(value) => setPref({ theme: value })}
        testIDPrefix="theme"
      />

      {/* Font Size */}
      <SectionHeader title="Font Size" />
      <OptionRow
        options={FONT_SIZE_OPTIONS}
        selected={prefs.font_size}
        onSelect={(value) => setPref({ font_size: value })}
        testIDPrefix="font-size"
      />

      {/* Font Family */}
      <SectionHeader title="Font Family" />
      <OptionRow
        options={FONT_FAMILY_OPTIONS}
        selected={prefs.font_family}
        onSelect={(value) => setPref({ font_family: value })}
        testIDPrefix="font-family"
      />

      {/* Accent Color */}
      <SectionHeader title="Accent Color" />
      <View style={styles.colorRow} testID="accent-colors">
        {ACCENT_COLORS.map((color) => (
          <TouchableOpacity
            key={color.value}
            style={[
              styles.colorSwatch,
              color.style,
              prefs.accent_color === color.value && styles.colorSwatchSelected,
            ]}
            onPress={() => setPref({ accent_color: color.value })}
            testID={`accent-${color.label.toLowerCase()}`}
          />
        ))}
      </View>

      {/* Language */}
      <SectionHeader title="Language" />
      <View style={styles.infoRow}>
        <Text style={styles.infoText}>
          Current: {prefs.language}
        </Text>
      </View>

      {/* Clarification Timeout */}
      <SectionHeader title="Clarification Timeout" />
      <OptionRow
        options={CLARIFICATION_MODE_OPTIONS}
        selected={clarificationMode}
        onSelect={(value) => updateSettings({ clarificationMode: value })}
        testIDPrefix="clarification-mode"
      />
      {clarificationMode === "auto-timeout" && (
        <View style={styles.optionRow}>
          {TIMEOUT_OPTIONS.map((mins) => (
            <TouchableOpacity
              key={mins}
              style={[
                styles.optionPill,
                clarificationTimeoutMinutes === mins &&
                  styles.optionPillSelected,
              ]}
              onPress={() =>
                updateSettings({ clarificationTimeoutMinutes: mins })
              }
              testID={`timeout-${mins}`}
            >
              <Text
                style={[
                  styles.optionPillText,
                  clarificationTimeoutMinutes === mins &&
                    styles.optionPillTextSelected,
                ]}
              >
                {mins}m
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Connection */}
      <SectionHeader title="Connection" />
      <View style={styles.card}>
        <Text style={styles.cardLabel} testID="settings-server-url">
          Server: {serverUrl ?? "Not connected"}
        </Text>
        <Text style={styles.cardSub} testID="settings-connection-status">
          Status: {connectionState}
        </Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleRepair}
            testID="settings-repair"
          >
            <Text style={styles.secondaryButtonText}>Re-pair</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.destructiveButton}
            onPress={handleDisconnect}
            testID="settings-disconnect"
          >
            <Text style={styles.destructiveButtonText}>Disconnect</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Debug */}
      <SectionHeader title="Debug" />
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Enable debug logging</Text>
        <Switch
          value={debugEncryptedTraffic}
          onValueChange={(value) =>
            updateSettings({ debugEncryptedTraffic: value })
          }
          testID="settings-debug-toggle"
        />
      </View>

      {/* About */}
      <SectionHeader title="About" />
      <View style={styles.infoRow}>
        <Text style={styles.infoText} testID="settings-app-version">
          App version: 1.0.0
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  content: {
    paddingBottom: 40,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 8,
    marginHorizontal: 16,
    letterSpacing: 0.5,
  },
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 4,
  },
  optionPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#e5e7eb",
  },
  optionPillSelected: {
    backgroundColor: "#3b82f6",
  },
  optionPillText: {
    fontSize: 14,
    color: "#374151",
  },
  optionPillTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  colorRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 4,
  },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  colorSwatchSelected: {
    borderWidth: 3,
    borderColor: "#111827",
  },
  infoRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  infoText: {
    fontSize: 14,
    color: "#374151",
  },
  card: {
    backgroundColor: "#fff",
    marginHorizontal: 12,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  cardLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  cardSub: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 12,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 8,
  },
  secondaryButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "#e5e7eb",
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
  },
  destructiveButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "#fecaca",
  },
  destructiveButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#dc2626",
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#fff",
    marginHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  switchLabel: {
    fontSize: 15,
    color: "#374151",
  },
});
