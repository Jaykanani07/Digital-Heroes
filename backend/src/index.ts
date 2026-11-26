import { app } from "./app.js";
import { env, paymentsMode } from "./config/env.js";
import { storageDriver } from "./services/storage.js";

app.listen(env.PORT, () => {
  console.log(`Digital Heroes API → http://localhost:${env.PORT}/api/health`);
  console.log(`  payments: ${paymentsMode === "test" ? "TEST MODE (no Stripe key)" : "Stripe"} · storage: ${storageDriver} · e-mail: ${env.SMTP_HOST ? "SMTP" : "console log"}`);
});
