// Mock dependencies before imports
jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
  }),
  useLocalSearchParams: () => ({ serverId: "test-server" }),
}));

jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock("@/lib/crypto", () => ({
  initCrypto: jest.fn().mockResolvedValue(undefined),
  generatePairingKeypair: jest.fn().mockReturnValue({
    publicKey: new Uint8Array(32),
    secretKey: new Uint8Array(32),
  }),
  verificationCode: jest.fn().mockReturnValue(["alpha", "bravo", "charlie", "delta"]),
}));

jest.mock("@/lib/crypto-storage", () => ({
  storePairingKeys: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/broker", () => ({
  requestPairing: jest.fn().mockResolvedValue({
    serverPublicKey: new Uint8Array(32),
  }),
  establishTunnel: jest.fn().mockResolvedValue({
    relayUrl: "https://relay.test",
    sessionToken: "token",
    pbAuthToken: "pb-token",
  }),
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

import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import PairScreen from "../pair";

describe("PairScreen", () => {
  it("renders loading state initially", () => {
    const { getByTestId } = render(<PairScreen />);
    expect(getByTestId("pair-loading")).toBeTruthy();
  });

  it("shows verification words after pairing starts", async () => {
    const { getByText, getByTestId } = render(<PairScreen />);
    await waitFor(() => {
      expect(getByTestId("pair-verify")).toBeTruthy();
    });
    expect(getByText("alpha")).toBeTruthy();
    expect(getByText("bravo")).toBeTruthy();
    expect(getByText("charlie")).toBeTruthy();
    expect(getByText("delta")).toBeTruthy();
  });

  it("shows confirm and cancel buttons in verify state", async () => {
    const { getByTestId } = render(<PairScreen />);
    await waitFor(() => {
      expect(getByTestId("pair-confirm")).toBeTruthy();
    });
    expect(getByTestId("pair-cancel")).toBeTruthy();
  });
});
