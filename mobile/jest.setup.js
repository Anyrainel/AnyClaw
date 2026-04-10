// Setup for React Native component tests
// Mock the native bridge that RN 0.81+ requires
jest.mock("react-native/Libraries/BatchedBridge/NativeModules", () => ({
  __esModule: true,
  default: {},
}));

// Provide a minimal RN mock for component tests
jest.mock("react-native", () => {
  const React = require("react");

  const createMockComponent = (name) => {
    const component = React.forwardRef((props, ref) => {
      return React.createElement(name, { ...props, ref }, props.children);
    });
    component.displayName = name;
    return component;
  };

  return {
    View: createMockComponent("View"),
    Text: createMockComponent("Text"),
    TextInput: createMockComponent("TextInput"),
    TouchableOpacity: createMockComponent("TouchableOpacity"),
    ScrollView: createMockComponent("ScrollView"),
    FlatList: React.forwardRef(({ data, renderItem, keyExtractor, ListEmptyComponent, ItemSeparatorComponent, ...props }, ref) => {
      const items = data || [];
      return React.createElement("FlatList", { ...props, ref },
        items.length === 0 && ListEmptyComponent
          ? React.createElement(ListEmptyComponent)
          : items.map((item, index) => {
              const key = keyExtractor ? keyExtractor(item, index) : String(index);
              return React.createElement(React.Fragment, { key }, [
                renderItem({ item, index }),
                ItemSeparatorComponent && index < items.length - 1
                  ? React.createElement(ItemSeparatorComponent, { key: `sep-${key}` })
                  : null,
              ]);
            })
      );
    }),
    ActivityIndicator: createMockComponent("ActivityIndicator"),
    Alert: {
      alert: jest.fn(),
    },
    StyleSheet: {
      create: (styles) => styles,
      absoluteFillObject: {
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      },
      flatten: (style) => style,
    },
    Platform: {
      OS: "ios",
      select: (obj) => obj.ios || obj.default,
    },
    Appearance: {
      getColorScheme: jest.fn(() => "light"),
    },
    PixelRatio: {
      getFontScale: jest.fn(() => 1.0),
    },
    AppState: {
      currentState: "active",
      addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    },
    Dimensions: {
      get: jest.fn(() => ({ width: 375, height: 812 })),
    },
  };
});

// Mock @testing-library/react-native with a simple render
jest.mock("@testing-library/react-native", () => {
  const React = require("react");
  const ReactTestRenderer = require("react-test-renderer");

  function render(element) {
    let root;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(element);
    });

    const toJSON = () => root.toJSON();

    function findByProps(props) {
      const json = root.toJSON();
      const results = [];
      findInTree(json, props, results);
      return results;
    }

    function findInTree(node, props, results) {
      if (!node) return;
      if (typeof node === "string") return;

      if (node.props) {
        let match = true;
        for (const key of Object.keys(props)) {
          if (node.props[key] !== props[key]) {
            match = false;
            break;
          }
        }
        if (match) results.push(node);
      }

      if (node.children) {
        for (const child of node.children) {
          findInTree(child, props, results);
        }
      }
    }

    function findText(text) {
      const json = root.toJSON();
      const results = [];
      findTextInTree(json, text, results);
      return results;
    }

    function findTextInTree(node, text, results) {
      if (!node) return;
      if (typeof node === "string") {
        if (node === text) results.push(node);
        return;
      }
      if (node.children) {
        // Check if any direct child is this text
        for (const child of node.children) {
          if (typeof child === "string" && child === text) {
            results.push(node);
          }
          findTextInTree(child, text, results);
        }
      }
    }

    return {
      toJSON,
      getByTestId: (testId) => {
        const found = findByProps({ testID: testId });
        if (found.length === 0) throw new Error(`Unable to find element with testID: ${testId}`);
        return found[0];
      },
      queryByTestId: (testId) => {
        const found = findByProps({ testID: testId });
        return found.length > 0 ? found[0] : null;
      },
      getByText: (text) => {
        const found = findText(text);
        if (found.length === 0) throw new Error(`Unable to find element with text: ${text}`);
        return found[0];
      },
      queryByText: (text) => {
        const found = findText(text);
        return found.length > 0 ? found[0] : null;
      },
      unmount: () => {
        ReactTestRenderer.act(() => {
          root.unmount();
        });
      },
    };
  }

  async function waitFor(callback, options = {}) {
    const timeout = options.timeout || 1000;
    const interval = options.interval || 50;
    const start = Date.now();

    while (true) {
      try {
        const result = callback();
        return result;
      } catch (error) {
        if (Date.now() - start >= timeout) {
          throw error;
        }
        await new Promise((r) => setTimeout(r, interval));
      }
    }
  }

  return {
    render,
    waitFor,
    act: ReactTestRenderer.act,
  };
});
