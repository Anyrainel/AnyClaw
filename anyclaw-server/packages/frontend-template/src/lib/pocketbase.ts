import PocketBase from "pocketbase";

/**
 * Singleton PocketBase client.
 * Defaults to the same origin (relative URL) so it works behind the
 * reverse proxy in production.  Override with VITE_PB_URL for local dev.
 */
const pb = new PocketBase(
  import.meta.env.VITE_PB_URL ?? window.location.origin,
);

export default pb;
