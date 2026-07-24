# Store Wave 1: dual-currency wallet migration

Wave 1 replaces the legacy single `balance` with independent `coins` and `diamonds`
amounts. Existing balance, lifetime credit, and lifetime debit values migrate to
coins. Diamonds begin at zero.

The migration is dry-run by default and refuses apply mode if any wallet has a
negative, unsafe, mismatched, or otherwise malformed legacy value.

```powershell
npm --prefix functions run wallet:migrate -- --actor-uid=ADMIN_UID --limit=500
```

After reviewing every JSON-line result:

```powershell
npm --prefix functions run wallet:migrate:apply -- --actor-uid=ADMIN_UID --limit=500
```

Use the printed cursor with `--start-after=UID` for the next bounded batch. Each
wallet is re-read and migrated transactionally, and an immutable admin audit event
records the resulting balances. Re-running either mode is safe.

Deploy all updated wallet writers before apply mode. The updated special-ID, social
gift, and admin-credit paths preserve both currencies and add `currency` to every
new ledger entry.
