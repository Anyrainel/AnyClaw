// Mock dependencies before imports
jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
  }),
}));

const mockTaskStore = {
  activeTask: null,
  submitTask: jest.fn(),
  answerQuestion: jest.fn(),
  cancelTask: jest.fn(),
  retryTask: jest.fn(),
  dismissTask: jest.fn(),
  resumeActiveTask: jest.fn(),
};

jest.mock("@/lib/tasks/store", () => ({
  useTaskStore: jest.fn((selector: (s: typeof mockTaskStore) => unknown) =>
    selector(mockTaskStore)
  ),
}));

jest.mock("date-fns", () => ({
  formatDistanceToNow: jest.fn(() => "just now"),
}));

import React from "react";
import { render } from "@testing-library/react-native";
import RequestScreen from "../request";

describe("RequestScreen", () => {
  beforeEach(() => {
    mockTaskStore.activeTask = null;
    jest.clearAllMocks();
  });

  it("renders task input when no active task", () => {
    const { getByTestId } = render(<RequestScreen />);
    expect(getByTestId("task-input")).toBeTruthy();
  });

  it("renders task card when there is an active task", () => {
    mockTaskStore.activeTask = {
      id: "task-1",
      state: "working",
      request: "Build a landing page",
      idempotencyKey: "idem_123",
      qaHistory: [],
      question: null,
      error: null,
    } as never;

    const { getByTestId } = render(<RequestScreen />);
    expect(getByTestId("task-card")).toBeTruthy();
    expect(getByTestId("task-working")).toBeTruthy();
  });

  it("shows clarifying question UI when task is in clarifying state", () => {
    mockTaskStore.activeTask = {
      id: "task-1",
      state: "clarifying",
      request: "Build a landing page",
      idempotencyKey: "idem_123",
      qaHistory: [],
      question: "What color scheme do you prefer?",
      error: null,
    } as never;

    const { getByTestId, getByText } = render(<RequestScreen />);
    expect(getByTestId("task-clarifying")).toBeTruthy();
    expect(getByText("What color scheme do you prefer?")).toBeTruthy();
  });

  it("shows failed state with retry button", () => {
    mockTaskStore.activeTask = {
      id: "task-1",
      state: "failed",
      request: "Build a landing page",
      idempotencyKey: "idem_123",
      qaHistory: [],
      question: null,
      error: "Server error",
    } as never;

    const { getByTestId, getByText } = render(<RequestScreen />);
    expect(getByTestId("task-failed")).toBeTruthy();
    expect(getByText("Server error")).toBeTruthy();
    expect(getByTestId("task-retry")).toBeTruthy();
  });

  it("calls resumeActiveTask on mount", () => {
    render(<RequestScreen />);
    expect(mockTaskStore.resumeActiveTask).toHaveBeenCalledWith("default");
  });
});
