jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  AndroidImportance: { HIGH: 4 },
}));

jest.mock("expo-device", () => ({
  isDevice: true,
}));

jest.mock("../api", () => ({
  apiClient: {
    post: jest.fn(),
  },
}));

import * as Notifications from "expo-notifications";
import { registerForPushNotifications, resolveNotificationRoute } from "../push";
import { apiClient } from "../api";

describe("push notifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("resolveNotificationRoute", () => {
    it("routes agent_question to request tab", () => {
      expect(resolveNotificationRoute({ type: "agent_question" })).toBe(
        "/(main)/request"
      );
    });

    it("routes deploy_complete to home tab", () => {
      expect(resolveNotificationRoute({ type: "deploy_complete" })).toBe(
        "/(main)"
      );
    });

    it("routes task_failed to request tab", () => {
      expect(resolveNotificationRoute({ type: "task_failed" })).toBe(
        "/(main)/request"
      );
    });

    it("returns null for unknown notification type", () => {
      expect(resolveNotificationRoute({ type: "unknown" })).toBeNull();
    });

    it("returns null when no type is present", () => {
      expect(resolveNotificationRoute({})).toBeNull();
    });
  });

  describe("registerForPushNotifications", () => {
    it("registers and sends token to server on granted permission", async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
        status: "granted",
      });
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
        data: "ExponentPushToken[abc123]",
      });
      (apiClient.post as jest.Mock).mockResolvedValue({});

      const token = await registerForPushNotifications();

      expect(token).toBe("ExponentPushToken[abc123]");
      expect(apiClient.post).toHaveBeenCalledWith("/api/device/register", {
        pushToken: "ExponentPushToken[abc123]",
        platform: "ios",
      });
    });

    it("requests permission if not already granted", async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
        status: "undetermined",
      });
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
        status: "granted",
      });
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
        data: "ExponentPushToken[def456]",
      });
      (apiClient.post as jest.Mock).mockResolvedValue({});

      const token = await registerForPushNotifications();

      expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
      expect(token).toBe("ExponentPushToken[def456]");
    });

    it("returns null when permission denied", async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
        status: "undetermined",
      });
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
        status: "denied",
      });

      const token = await registerForPushNotifications();

      expect(token).toBeNull();
      expect(apiClient.post).not.toHaveBeenCalled();
    });
  });
});
