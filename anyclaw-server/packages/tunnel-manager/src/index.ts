import { loadTunnelConfig } from "./config.js";
import { ServiceRouter } from "./router.js";
import { reconnectLoop } from "./reconnect.js";

export * from "./config.js";
export * from "./router.js";
export * from "./reconnect.js";

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const secretsDir = process.env.ANYCLAW_SECRETS_DIR ?? "/data/.anyclaw";
  loadTunnelConfig({ secretsDir }).then(cfg => {
    const router = new ServiceRouter({ pb: 8090, api: 4100, app: 5173 });
    // eslint-disable-next-line no-console
    console.log(`[tunnel-manager] broker=${cfg.brokerUrl} routes pb=${router.portFor("pb")} api=${router.portFor("api")} app=${router.portFor("app")}`);
    return reconnectLoop({
      brokerUrl: cfg.brokerUrl,
      onAttempt: (n, d) => console.log(`[tunnel-manager] (stub) connect attempt ${n} would wait ${d}ms`),
      stopAfter: 1,
    });
  }).catch(err => {
    // eslint-disable-next-line no-console
    console.error(`[tunnel-manager] startup failed:`, err);
    process.exit(1);
  });
}
