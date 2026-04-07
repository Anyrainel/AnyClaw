import express, { type Express } from "express";

export function createFallbackApp(): Express {
  const app = express();
  app.use((_req, res) => {
    res.status(503).json({ error: "no_logic_deployed" });
  });
  return app;
}
