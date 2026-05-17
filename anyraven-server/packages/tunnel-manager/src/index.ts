import { loadTunnelConfig } from "./config.js";
import { ServiceRouter } from "./router.js";
import { reconnectLoop } from "./reconnect.js";

export * from "./config.js";
export * from "./router.js";
export * from "./reconnect.js";

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const secretsDir = process.env.ANYRAVEN_SECRETS_DIR ?? "/data/.anyraven";
  const tunnelUrl = process.env.ANYRAVEN_TUNNEL_URL;
  const mode = process.env.ANYRAVEN_CONNECTION_MODE as "broker" | "direct" | "wireguard" | "public_tunnel" | undefined;
  const brokerUrl = process.env.ANYRAVEN_BROKER_URL ?? undefined;

  loadTunnelConfig({
    secretsDir,
    tunnelUrl,
    mode,
    brokerUrl,
  }).then(async cfg => {
    const router = new ServiceRouter({ pb: 8090, api: 4100, app: 5173 });
    // eslint-disable-next-line no-console
    console.log(`[tunnel-manager] mode=${cfg.mode} broker=${cfg.brokerUrl ?? "(none)"} tunnel=${cfg.tunnelUrl ?? "(none)"} routes pb=${router.portFor("pb")} api=${router.portFor("api")} app=${router.portFor("app")}`);

    await reconnectLoop({
      mode: cfg.mode,
      brokerUrl: cfg.brokerUrl ?? undefined,
      tunnelUrl: cfg.tunnelUrl ?? undefined,
      onAttempt: (n, d) => console.log(`[tunnel-manager] (stub) connect attempt ${n} would wait ${d}ms`),
      stopAfter: 1,
    });

    // Baseline local mode does not open a real tunnel yet, but supervisor
    // should still see the manager as healthy instead of a short-lived task.
    await new Promise<void>((resolve) => {
      const keepAlive = setInterval(() => undefined, 1 << 30);
      const stop = () => {
        clearInterval(keepAlive);
        resolve();
      };
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
    });
  }).catch(err => {
    // eslint-disable-next-line no-console
    console.error(`[tunnel-manager] startup failed:`, err);
    process.exit(1);
  });
}
