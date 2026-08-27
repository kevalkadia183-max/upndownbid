import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import { PaymentError } from "./lib/payments";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

type AppOptions = {
  clerkAuthMiddleware?: RequestHandler;
};

export function createApp(options: AppOptions = {}): Express {
  const app: Express = express();

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
  app.use("/api/payments/webhooks", express.raw({ type: "application/json", limit: "1mb" }));
  app.use("/api/paypal/webhook", express.raw({ type: "application/json", limit: "1mb" }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    options.clerkAuthMiddleware ??
      clerkMiddleware((req) => ({
        publishableKey: publishableKeyFromHost(
          getClerkProxyHost(req) ?? "",
          process.env.CLERK_PUBLISHABLE_KEY,
        ),
      })),
  );

  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/payments/webhooks/") || req.path === "/paypal/webhook") {
      next();
      return;
    }
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      next();
      return;
    }

    const origin = req.get("origin");
    if (!origin) {
      res.status(403).json({ error: "Same-origin requests are required" });
      return;
    }

    try {
      const originHost = new URL(origin).host;
      const requestHost = req.get("host")?.trim();
      if (!requestHost || originHost !== requestHost) {
        res.status(403).json({ error: "Cross-origin requests are not allowed" });
        return;
      }
    } catch {
      res.status(403).json({ error: "Invalid request origin" });
      return;
    }
    next();
  });
  app.use("/api", router);
  const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
    req.log.error({ err: error }, "Unhandled API request error");
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof PaymentError) {
      res.status(error.statusCode).json({
        error: error.message,
        ...(error.retryable === undefined ? {} : { retryable: error.retryable }),
      });
      return;
    }
    res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  };
  app.use(errorHandler);

  return app;
}

export default createApp();
