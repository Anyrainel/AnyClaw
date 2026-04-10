import { Tabs } from "expo-router";
import { useTaskStore } from "@/lib/tasks/store";

export default function MainLayout() {
  const activeTask = useTaskStore((s) => s.activeTask);
  const showBadge = activeTask?.state === "clarifying";

  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen
        name="request"
        options={{
          title: "Request",
          tabBarBadge: showBadge ? "!" : undefined,
        }}
      />
      <Tabs.Screen name="versions" options={{ title: "Versions" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
      <Tabs.Screen name="task/[id]" options={{ href: null }} />
    </Tabs>
  );
}
