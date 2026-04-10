import { Tabs } from "expo-router";

export default function MainLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="request" options={{ title: "Request" }} />
      <Tabs.Screen name="versions" options={{ title: "Versions" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
      <Tabs.Screen name="task/[id]" options={{ href: null }} />
    </Tabs>
  );
}
