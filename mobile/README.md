# mobile

The AnyRaven companion app. An Expo / React Native app (iOS, Android, Web) that connects to the user's anyraven-server, displays the agent-built WebView interface, and provides controls for task submission, version history, settings, and server pairing.

See [docs/plan5-mobile-app-design.md](../docs/plan5-mobile-app-design.md) for architecture details.

## Screens

| Route | Screen |
|---|---|
| `/(auth)/login` | OAuth login (Google / Apple / GitHub) |
| `/(auth)/pair` | Server pairing (QR scan or manual token entry) |
| `/(auth)/server-list` | Manage paired servers |
| `/(main)/` | Home — agent-built WebView |
| `/(main)/request` | Submit a task request with optional clarification Q&A |
| `/(main)/versions` | Version history and rollback |
| `/(main)/settings` | Theme, accent color, font, language, push notifications |
| `/(main)/task/[id]` | Live task progress |
| `/(onboarding)/` | First-run onboarding (theme / font / accent / language) |

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Expo SDK 54 / React Native 0.81 |
| Routing | expo-router (file-based) |
| State | Zustand |
| Auth | expo-auth-session (OAuth PKCE) |
| Secure storage | expo-secure-store |
| Push notifications | expo-notifications |
| Backend client | PocketBase JS SDK 0.25 |
| Encryption | libsodium-wrappers + tweetnacl-util |
| Animations | react-native-reanimated + gesture-handler |

## Project Layout

```
mobile/
├── app/
│   ├── _layout.tsx              Root layout (auth routing, push setup)
│   ├── (auth)/                  Login, pair, server-list
│   ├── (main)/                  Home, request, versions, settings, task/[id]
│   └── (onboarding)/            First-run flow
├── lib/
│   ├── api.ts                   HTTP client for dispatch REST API
│   ├── broker.ts                WebSocket connection to broker
│   ├── bridge.ts                WebView ↔ native message bridge
│   ├── crypto.ts                NaCl box helpers
│   ├── crypto-storage.ts        Pairing key persistence
│   ├── push.ts                  Push notification registration + routing
│   ├── connection/
│   │   └── store.ts             Zustand: auth state, server connection, reconnect
│   ├── preferences/
│   │   └── store.ts             Zustand: theme, accent, font, language
│   └── pocketbase/
│       └── sse.ts               PocketBase SSE subscriptions (tasks, messages, deploys)
├── components/                  Shared UI components
├── constants/                   Design tokens, theme values
├── hooks/                       usePreferences and other shared hooks
├── assets/                      Fonts, images
└── package.json
```

## Development

```bash
npm install
npm start            # Expo dev server (scan QR with Expo Go)
npm run android      # Android emulator / device
npm run ios          # iOS simulator / device
npm run web          # Expo Web
npm run typecheck    # tsc --noEmit
npm test             # Jest
npm run lint         # expo lint
```

## Key Libraries

- **`lib/connection/store.ts`** — Zustand store managing server authentication, WebSocket lifecycle, and exponential-backoff reconnection.
- **`lib/preferences/store.ts`** — User preferences (theme, accent color, font scale, language) synced from PocketBase.
- **`lib/pocketbase/sse.ts`** — `subscribeToTask`, `subscribeToAgentMessages`, `subscribeToDeployments` — all with NaCl envelope decryption.
- **`lib/bridge.ts`** — Message bridge between the WebView (agent-built frontend) and native code; injects preferences and handles native requests.
