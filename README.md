# polybot!

Bun is required to run this project. You can install it from [here](https://bun.sh/).

Alchemy RPC Token is required to run this project, you can aquire it [here](https://www.alchemy.com/). (after login search for "Account Kit Quickstart" and go to "Networks" tab to enable Polygon network and grab the token)

```bash
bun install
```

prepare the environment variables copy `.env.example` to `.env` and fill in the values.

use [Phantom](https://phantom.app/)/[MetaMask](https://metamask.io/) to export the private key and set `PK`, connect your wallet with polymarket to get their internal wallet, use polymarket address to set `POLYMARKET_FUNDER_ADDRESS`
when both are set generate api keys with `generate-key.ts` script

```bash
bun run src/utils/generate-key.ts
```

To setup / reset the database

```bash
bun drizzle
```

to seed the database

```bash
bun markets
```

<!-- I need a safe bet that I can place based on current facts and logic. The data is already prefiltered with risk and tolerance categories, which don’t matter, but it has to be based on data. its not about probablity but about the already known facts via news and outlets -->

<!-- market_slug ILIKE '%november%' AND market_slug ILIKE 'will-%have-the-best-ai-model%' AND market_slug NOT ILIKE '%style-control%' AND active IS TRUE -->
<!-- market_slug ILIKE '%2025%' AND market_slug ILIKE 'will-%have-the-best-ai-model%' AND market_slug NOT ILIKE '%style-control%' AND active IS TRUE -->
