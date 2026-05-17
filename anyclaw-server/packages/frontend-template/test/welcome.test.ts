/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { createElement } from "react";

const { mockListTasks, mockCreateTask, mockCancelTask } = vi.hoisted(() => {
  const mockListTasks = vi.fn();
  const mockCreateTask = vi.fn();
  const mockCancelTask = vi.fn();
  return { mockListTasks, mockCreateTask, mockCancelTask };
});

vi.mock("../src/lib/dispatch-api.js", () => ({
  listTasks: mockListTasks,
  createTask: mockCreateTask,
  getTask: vi.fn(),
  cancelTask: mockCancelTask,
}));

vi.mock("../src/hooks/usePreferences.js", () => ({
  usePreferences: () => ({
    theme: "system",
    fontSize: "medium",
    fontFamily: "sans",
    accent: "blue",
    language: "en-US",
  }),
}));

import { Welcome } from "../src/pages/Welcome.js";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockListTasks.mockResolvedValue([]);
  mockCreateTask.mockImplementation(({ taskId, request }) =>
    Promise.resolve({ taskId, state: "queued", seq: 0, request }),
  );
  mockCancelTask.mockImplementation((taskId) =>
    Promise.resolve({ taskId, state: "cancelled", seq: 1 }),
  );
});

afterEach(() => {
  cleanup();
});

describe("Welcome app shell", () => {
  it("renders the three baseline tabs", () => {
    render(createElement(Welcome));
    expect(screen.getByRole("heading", { name: "Home" })).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Home" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Tutorial" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "AnyRaven" }).length).toBeGreaterThan(0);
  });

  it("shows placeholder home and tutorial examples", () => {
    render(createElement(Welcome));
    expect(screen.getByText("Your app starts here.")).toBeDefined();

    fireEvent.click(screen.getAllByRole("button", { name: "Tutorial" })[0]!);
    expect(screen.getByText("Ask for a small tool")).toBeDefined();
    expect(screen.getByText(/starter material for the free canvas/)).toBeDefined();
  });

  it("opens settings and applies local theme choices", () => {
    const { container } = render(createElement(Welcome));
    fireEvent.click(screen.getAllByRole("button", { name: "AnyRaven" })[0]!);
    fireEvent.click(screen.getAllByLabelText("Open settings")[0]!);

    const theme = screen.getByLabelText("Theme mode");
    fireEvent.change(theme, { target: { value: "dark" } });

    const shell = container.querySelector(".app-shell");
    expect(shell?.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("anyclaw_shell_preferences")).toContain('"theme":"dark"');
  });

  it("shows AnyRaven work history in the last tab", async () => {
    render(createElement(Welcome));
    fireEvent.click(screen.getAllByRole("button", { name: "AnyRaven" })[0]!);

    await waitFor(() => {
      expect(mockListTasks).toHaveBeenCalled();
    });
    expect(screen.getByText("App evolution")).toBeDefined();
    expect(screen.getByText("No requests yet.")).toBeDefined();
  });

  it("creates a dispatch task from the full screen request modal", async () => {
    render(createElement(Welcome));
    fireEvent.click(screen.getAllByRole("button", { name: "AnyRaven" })[0]!);
    fireEvent.click(screen.getByLabelText("Open new AnyRaven request"));

    const input = screen.getByPlaceholderText(/Build a simple habit tracker/);
    fireEvent.change(input, { target: { value: "Build me a mood tracker" } });
    fireEvent.click(screen.getByLabelText("Submit request"));

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({ request: "Build me a mood tracker" }),
      );
    });
  });

  it("lists progress, errors, and version details from dispatch tasks", async () => {
    mockListTasks.mockResolvedValue([
      {
        taskId: "t1",
        state: "working",
        seq: 1,
        request: "Working task",
        progressSummary: "Building...",
      },
      {
        taskId: "t2",
        state: "failed",
        seq: 2,
        request: "Failed task",
        error: "oops",
      },
      {
        taskId: "t3",
        state: "done",
        seq: 3,
        request: "Done task",
        version: "v4",
        commitSha: "abcdef123456",
        deploymentUrl: "https://app.example",
      },
    ]);

    render(createElement(Welcome));
    fireEvent.click(screen.getAllByRole("button", { name: "AnyRaven" })[0]!);

    await waitFor(() => {
      expect(screen.getByText("Working task")).toBeDefined();
    });
    expect(screen.getByText("Building...")).toBeDefined();
    expect(screen.getByText("oops")).toBeDefined();
    expect(screen.getByText(/Version v4/)).toBeDefined();
    expect(screen.getByText(/Commit abcdef1/)).toBeDefined();
  });

  it("drills into AnyRaven feature requests and work history", async () => {
    mockListTasks.mockResolvedValue([
      {
        taskId: "t1",
        state: "working",
        seq: 1,
        request: "Working task",
      },
      {
        taskId: "t2",
        state: "done",
        seq: 2,
        request: "Done task",
      },
    ]);

    render(createElement(Welcome));
    fireEvent.click(screen.getAllByRole("button", { name: "AnyRaven" })[0]!);

    await waitFor(() => {
      expect(screen.getByText("Working task")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: /Feature requests/ }));
    expect(screen.getByText("Feature request history")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: /Work history/ }));
    expect(screen.getByText("Done task")).toBeDefined();
  });

  it("contains no hardcoded hex colors in Welcome source", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "pages", "Welcome.tsx"),
      "utf-8",
    );
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
