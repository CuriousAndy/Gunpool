# gunpool-frontend

This frontend reads live on-chain data and historical lending APY data from a local SQLite database.

## Run

From repository root:

```bash
npm run chain
npm run deploy:local:once
npm run frontend:dev
```

Then open `http://localhost:3000`.

`deploy:local:once` prevents accidental redeploy on every restart and keeps historical records stable.

## New data pipeline (for thesis demo)

- Historical APY is fetched from DefiLlama and persisted in `gunpool-frontend/.local/market-data.sqlite`.
- API route `GET /api/market-apy` reads from SQLite (not from frontend hardcoded state).
- API route `POST /api/market-apy` forces a backend sync.
- Sync includes retry, exponential backoff, user-agent rotation, and concurrent worker fetches.

Manual sync command (frontend server must be running):

```bash
npm --prefix gunpool-frontend run sync:market
```

## Pages

- `/` : Yield overview, wallet actions, pool snapshot.
- `/apy` : Real APY curves from **2023-01-01 to now**, protocol multi-select, strategy dashed line.
- `/history` : On-chain events with search/filter + rebalance decision process table (gain vs fee).
- Local history DB file: `gunpool-frontend/.local/local-history.sqlite` (append-only persistence).

## Source files

- `app/api/market-apy/route.ts`
- `src/lib/server/market-db.ts`
- `src/lib/server/market-sync.ts`
- `app/apy/page.tsx`
- `app/history/page.tsx`
