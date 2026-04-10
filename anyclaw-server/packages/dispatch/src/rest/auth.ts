import type { RequestHandler } from "express";

export interface AuthDeps {
  verify: (token: string) => Promise<string | null>;
}

/**
 * Express middleware that validates a Bearer token.
 * On success, attaches `req.userToken` with the resolved user identifier.
 * On failure, responds with 401.
 */
export function authRequired(deps: AuthDeps): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const token = header.slice("Bearer ".length);
    const userId = await deps.verify(token);
    if (!userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    (req as unknown as { userToken: string }).userToken = userId;
    next();
  };
}
