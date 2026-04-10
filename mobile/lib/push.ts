import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { apiClient } from "./api";

/**
 * Register for Expo push notifications.
 * Requests permissions, creates an Android notification channel,
 * retrieves the push token, and registers it with the server.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }

  // Request permission
  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  // Android: create high-importance channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  // Get the push token
  const tokenData = await Notifications.getExpoPushTokenAsync();
  const pushToken = tokenData.data;

  // Register with the server
  await apiClient.post("/api/device/register", {
    pushToken,
    platform: Platform.OS,
  });

  return pushToken;
}

/**
 * Pure routing function: given notification data, returns the target route.
 */
export function resolveNotificationRoute(
  data: Record<string, unknown>
): string | null {
  switch (data.type) {
    case "agent_question":
      return "/(main)/request";
    case "deploy_complete":
      return "/(main)";
    case "task_failed":
      return "/(main)/request";
    default:
      return null;
  }
}
