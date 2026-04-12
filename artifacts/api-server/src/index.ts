import app from "./app";
import { logger } from "./lib/logger";
import { initWallets, getAxisTreasuryKeypair, getDemoAgentKeypair } from "./lib/stellar";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  const axisAddress = getAxisTreasuryKeypair().publicKey();
  const demoAddress = getDemoAgentKeypair().publicKey();
  logger.info({ axisAddress, demoAddress }, "AXIS wallet addresses");

  initWallets()
    .then(() => {
      logger.info("AXIS wallets initialized successfully");
    })
    .catch((err) => {
      logger.error({ err }, "Failed to initialize AXIS wallets — restart server to retry");
    });
});
