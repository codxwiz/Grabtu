# Security

Do not commit `.env` files, Firebase service-account JSON, private keys, payment-provider secrets, JWT secrets, database URLs, or production customer uploads.

Report a suspected vulnerability privately to the support address configured for the deployed product. Include reproduction steps and impact, but never include live credentials or customer data.

Before publishing or deploying, run `npm run check:secrets` and rotate any credential that may have been exposed.
