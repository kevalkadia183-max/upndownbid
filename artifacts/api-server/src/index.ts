import app from "./app";
import { runCampaignScheduler } from "./lib/campaigns";
import { logger } from "./lib/logger";
import { paymentRuntimeConfiguration } from "./lib/payments";
import { runSponsorshipScheduler } from "./lib/sponsorships";

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

  logger.info({ port, payment: paymentRuntimeConfiguration() }, "Server listening");
  void runCampaignScheduler().catch((error) => {
    logger.error({ error }, "Initial campaign scheduler run failed");
  });
  const campaignTimer = setInterval(() => {
    void runCampaignScheduler().catch((error) => {
      logger.error({ error }, "Campaign scheduler run failed");
    });
  }, 60_000);
  campaignTimer.unref();

  void runSponsorshipScheduler().catch((error) => {
    logger.error({ error }, "Initial sponsorship scheduler run failed");
  });
  const sponsorshipTimer = setInterval(() => {
    void runSponsorshipScheduler().catch((error) => {
      logger.error({ error }, "Sponsorship scheduler run failed");
    });
  }, 60_000);
  sponsorshipTimer.unref();
});
