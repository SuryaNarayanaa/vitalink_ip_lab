import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import router from "./routes";
import errorHandler from "./middlewares/errorHandler";
import { ApiError, ApiResponse } from "./utils";
import { StatusCodes } from "http-status-codes";
import morgan from "morgan";
import logger from "./utils/logger";
import cors from "cors";
import mongoose from "mongoose";
import { randomUUID } from "crypto";
import { config, getMissingEnvironmentVariables } from "./config";
import { getFirebaseMessagingHealth } from './config/firebase.config'
import { getNotificationDeliveryWorkerHealth } from './jobs/notification-delivery.worker'
import { apiLimiter, authLimiter } from "./config/ratelimiter";
import { apiVersionHeaders, legacyApiHeaders } from "./middlewares/apiVersion.middleware";
import { enforceSystemFeatureFlags } from './middlewares/systemConfig.middleware'

const app = express();
app.set('trust proxy', config.trustProxy);
const dbStates: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

morgan.token('request-id', (req: Request) => (req as any).requestId ?? '-');
morgan.token('safe-url', (req: Request) => {
  const rawUrl = req.originalUrl || req.url || ''
  if (!rawUrl.includes('?')) {
    return rawUrl
  }

  const [path, queryString] = rawUrl.split('?')
  const params = new URLSearchParams(queryString || '')
  const sensitiveQueryParams = new Set([
    'token',
    'access_token',
    'refresh_token',
    'authorization',
    'password',
    'code',
    'otp',
    'totp',
    'secret',
  ])

  for (const key of Array.from(params.keys())) {
    if (sensitiveQueryParams.has(key.toLowerCase())) {
      params.set(key, '[redacted]')
    }
  }
  return `${path}?${params.toString()}`
});

app.use((req: Request, res: Response, next: NextFunction) => {
  const incomingRequestId = req.header('x-request-id')?.trim();
  const sanitized = incomingRequestId
    ? incomingRequestId.replace(/[^\x20-\x7E]/g, '').slice(0, 128)
    : '';
  const requestId = sanitized || randomUUID();

  (req as any).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

app.use(morgan(':method :safe-url :status :res[content-length] - :response-time ms [request-id=:request-id]', {
  stream: {
    write: message => {
      logger.info(message.trim());
    }
  }
}));

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true)
      return
    }

    if (config.nodeEnv !== 'production' && config.corsAllowedOrigins.length === 0) {
      callback(null, true)
      return
    }

    if (config.corsAllowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }

    callback(new ApiError(StatusCodes.FORBIDDEN, 'CORS origin is not allowed'))
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-API-Version'],
  exposedHeaders: ['X-Request-Id', 'X-API-Version', 'X-API-Supported-Versions', 'Deprecation', 'Sunset', 'Link'],
  optionsSuccessStatus: 204,
}));

app.use((req: Request, res: Response, next: NextFunction) => {
  req.setTimeout(config.requestTimeoutMs)
  res.setTimeout(config.requestTimeoutMs)
  next()
})

app.use(express.json({ limit: config.jsonBodyLimit }));

app.get("/", (req, res) => {
  return res.json(new ApiResponse(StatusCodes.OK, "The Api is running", {
    current_api_version: config.apiVersion,
    versioned_base_path: `/api/${config.apiVersion}`,
    legacy_base_path: '/api',
  }))
});

app.get('/api', legacyApiHeaders, (_req, res) => {
  return res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'API index', {
    current_version: config.apiVersion,
    current_base_path: `/api/${config.apiVersion}`,
    legacy_base_path: '/api',
    legacy_sunset: config.legacyApiSunsetDate,
  }))
})

app.get(`/api/${config.apiVersion}`, apiVersionHeaders(config.apiVersion), (_req, res) => {
  return res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'API version index', {
    version: config.apiVersion,
    routes: ['auth', 'doctors', 'patient', 'admin', 'statistics'],
  }))
})

app.get('/health/live', (req, res) => {
  return res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Service is live'))
});

app.get('/health/ready', (req, res) => {
  const readyState = mongoose.connection.readyState;
  const databaseState = dbStates[readyState] || 'unknown';
  const firebase = getFirebaseMessagingHealth();
  const notificationWorker = getNotificationDeliveryWorkerHealth();
  const missingEnvironmentVariables = getMissingEnvironmentVariables();
  const databaseReady = readyState === 1;
  const firebaseReady = firebase.state !== 'failed';
  const workerReady = !notificationWorker.enabled || notificationWorker.state === 'started';
  const configurationReady = missingEnvironmentVariables.length === 0;
  const isReady = databaseReady && firebaseReady && workerReady && configurationReady;
  const responseData = {
    database: {
      state: databaseState,
      connected: databaseReady,
      connection_success: databaseReady,
    },
    firebase: {
      ...firebase,
      initialization_success: firebase.state === 'initialized',
    },
    notification_worker: {
      ...notificationWorker,
      started: notificationWorker.state === 'started',
    },
    configuration: {
      ready: configurationReady,
      no_missing_environment_variables: configurationReady,
      missing_environment_variables: missingEnvironmentVariables,
    },
  };

  if (!isReady) {
    return res
      .status(StatusCodes.SERVICE_UNAVAILABLE)
      .json(new ApiResponse(StatusCodes.SERVICE_UNAVAILABLE, 'Service is not ready', responseData));
  }

  return res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Service is ready', responseData));
});

if (config.apiDocsEnabled) {
  const docsRouter = require("./routes/docs.routes").default;
  app.use(config.apiDocsPath, docsRouter);
}

app.use(`/api/${config.apiVersion}/auth/login`, apiVersionHeaders(config.apiVersion), authLimiter);
app.use('/api/auth/login', legacyApiHeaders, authLimiter);

app.use(`/api/${config.apiVersion}`, apiLimiter, enforceSystemFeatureFlags, apiVersionHeaders(config.apiVersion), router);
app.use("/api", apiLimiter, enforceSystemFeatureFlags, legacyApiHeaders, router);
app.use('/api', (req, res) => {
  return res.status(StatusCodes.NOT_FOUND).json(new ApiResponse(StatusCodes.NOT_FOUND, 'API route not found', {
    path: req.originalUrl,
    current_api_version: config.apiVersion,
    current_base_path: `/api/${config.apiVersion}`,
  }))
});
app.use(errorHandler);

export default app;
