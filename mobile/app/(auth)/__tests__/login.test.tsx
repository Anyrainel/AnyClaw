// Mock dependencies before imports
jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
  }),
}));

jest.mock("@/lib/broker", () => ({
  loginWithProvider: jest.fn(),
}));

jest.mock("@/lib/connection/store", () => ({
  useConnectionStore: Object.assign(jest.fn(() => ({})), {
    setState: jest.fn(),
    getState: jest.fn(() => ({})),
  }),
}));

jest.mock("react-native/Libraries/Alert/Alert", () => ({
  alert: jest.fn(),
}));

import React from "react";
import { render } from "@testing-library/react-native";
import LoginScreen from "../login";

describe("LoginScreen", () => {
  it("renders without crashing", () => {
    const { getByTestId } = render(<LoginScreen />);
    expect(getByTestId("login-google")).toBeTruthy();
    expect(getByTestId("login-apple")).toBeTruthy();
    expect(getByTestId("login-github")).toBeTruthy();
  });

  it("shows all three OAuth provider buttons", () => {
    const { getByText } = render(<LoginScreen />);
    expect(getByText("Continue with Google")).toBeTruthy();
    expect(getByText("Continue with Apple")).toBeTruthy();
    expect(getByText("Continue with GitHub")).toBeTruthy();
  });

  it("displays the app title and subtitle", () => {
    const { getByText } = render(<LoginScreen />);
    expect(getByText("AnyClaw")).toBeTruthy();
    expect(getByText("Sign in to get started")).toBeTruthy();
  });
});
