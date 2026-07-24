# Store Wave 8: wallet-transfer notification controls

Wave 8 separates representative recharge alerts from social and store gift alerts.

- `walletTransfers` is an independent push-notification preference.
- Representative sent/received notifications use `walletTransfers`; store and social gifts continue using `gifts`.
- Existing preference documents without `walletTransfers` default to enabled.
- Older mobile builds may continue sending the original three-key preference payload; the backend normalizes it to the new four-key contract with wallet transfers enabled.
- New mobile builds expose an Arabic wallet-recharge switch in notification settings.

Only `socialCommand` requires deployment. The mobile source remains local until a new app build is distributed. Hosting and `adminDashboard` remain excluded.
