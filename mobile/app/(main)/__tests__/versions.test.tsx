// Mock dependencies before imports
jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
  }),
}));

const mockVersionsStore: Record<string, unknown> = {
  versions: [],
  isLoading: false,
  error: null,
  fetchVersions: jest.fn(),
  rollbackTo: jest.fn(),
};

jest.mock("@/lib/versions/store", () => ({
  useVersionsStore: jest.fn((selector: (s: typeof mockVersionsStore) => unknown) =>
    selector(mockVersionsStore)
  ),
}));

import React from "react";
import { render } from "@testing-library/react-native";
import VersionsScreen from "../versions";

describe("VersionsScreen", () => {
  beforeEach(() => {
    mockVersionsStore.versions = [];
    mockVersionsStore.isLoading = false;
    mockVersionsStore.error = null;
    (mockVersionsStore.fetchVersions as jest.Mock).mockClear();
    (mockVersionsStore.rollbackTo as jest.Mock).mockClear();
  });

  it("calls fetchVersions on mount", () => {
    render(<VersionsScreen />);
    expect(mockVersionsStore.fetchVersions).toHaveBeenCalled();
  });

  it("shows loading state", () => {
    mockVersionsStore.isLoading = true;
    const { getByTestId } = render(<VersionsScreen />);
    expect(getByTestId("versions-loading")).toBeTruthy();
  });

  it("shows error state with retry button", () => {
    mockVersionsStore.error = "Network error";
    const { getByTestId, getByText } = render(<VersionsScreen />);
    expect(getByTestId("versions-error")).toBeTruthy();
    expect(getByText("Network error")).toBeTruthy();
    expect(getByTestId("versions-retry")).toBeTruthy();
  });

  it("shows empty state when no versions", () => {
    const { getByTestId } = render(<VersionsScreen />);
    expect(getByTestId("versions-empty")).toBeTruthy();
  });

  it("renders version rows with current badge on first item", () => {
    mockVersionsStore.versions = [
      { id: "v1", label: "v1.0.0", createdAt: "2026-01-01T00:00:00Z" },
      { id: "v2", label: "v0.9.0", createdAt: "2025-12-15T00:00:00Z" },
    ];
    const { getByTestId, queryByTestId } = render(<VersionsScreen />);
    expect(getByTestId("version-row-v1")).toBeTruthy();
    expect(getByTestId("version-row-v2")).toBeTruthy();
    expect(getByTestId("current-badge")).toBeTruthy();
    // First version should NOT have a rollback button
    expect(queryByTestId("rollback-v1")).toBeNull();
    // Second version should have a rollback button
    expect(getByTestId("rollback-v2")).toBeTruthy();
  });
});
