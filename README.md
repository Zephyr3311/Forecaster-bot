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

