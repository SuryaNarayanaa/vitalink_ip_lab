import app from "./app";
import { config } from "./config";
import connectDB from "./config/db";
import mongoose from "mongoose";
import { Server } from "http";
import logger from './utils/logger'
import '@alias/jobs/dosage.scheduler'  
import { initializeFirebaseMessaging } from '@alias/config/firebase.config'

let server: Server | null = null;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`${signal} received. Shutting down gracefully.`);

  try {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }

    logger.info('Shutdown complete.');
    process.exit(0);
  } catch (error) {
    logger.error(`Shutdown failed: ${(error as Error).message}`);
    process.exit(1);
  }
}

async function startServer() {
  const PORT = config.port;

  try {
    initializeFirebaseMessaging()
    await connectDB();
    server = app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
    });
  }
  catch (err) {
    logger.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

startServer();
