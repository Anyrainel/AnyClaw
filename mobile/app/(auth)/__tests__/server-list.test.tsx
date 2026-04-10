// Mock dependencies before imports
jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
  }),
}));

jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock("@/lib/broker", () => ({
  fetchServers: jest.fn().mockResolvedValue({ servers: [] }),
  establishTunnel: jest.fn(),
}));

jest.mock("@/lib/connection/store", () => ({
  useConnectionStore: Object.assign(jest.fn(() => ({})), {
    setState: jest.fn(),
    getState: jest.fn(() => ({})),
  }),
}));

jest.mock("@/lib/api", () => ({
  apiClient: {
    configure: jest.fn(),
  },
}));

jest.mock("@/lib/pocketbase", () => ({
  initPocketBase: jest.fn(),
}));

jest.mock("react-native/Libraries/Alert/Alert", () => ({
  alert: jest.fn(),
}));

import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import ServerListScreen from "../server-list";

describe("ServerListScreen", () => {
  it("renders loading state initially", () => {
    const { getByTestId } = render(<ServerListScreen />);
    expect(getByTestId("server-list-loading")).toBeTruthy();
  });

  it("shows empty state when no servers", async () => {
    const { getByTestId } = render(<ServerListScreen />);
    await waitFor(() => {
      expect(getByTestId("server-list-empty")).toBeTruthy();
    });
  });

  it("shows 'No Servers' message in empty state", async () => {
    const { getByText } = render(<ServerListScreen />);
    await waitFor(() => {
      expect(getByText("No Servers")).toBeTruthy();
    });
  });
});
