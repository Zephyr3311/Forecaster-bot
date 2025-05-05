# polybot

Bun is required to run this project. You can install it from [here](https://bun.sh/).

Alchemy RPC Token is required to run this project, you can aquire it [here](https://www.alchemy.com/). (search for "Account Kit Quickstart" and go to "Networks" tab to enable Polygon network)

```bash
bun install
```

prepare the environment variables copy `.env.example` to `.env` and fill in the values.

Use Metamask/Phantom to export the private key to set `PK` and connect with polymarket to get their internal wallet, use polymarket address to set `POLYMARKET_FUNDER_ADDRESS`
when both are set generate api keys with `generate-key.ts` script

```bash
bun run src/utils/generate-key.ts
```

To reset / setup the database

```bash
bun drizzle
```

to seed the database

```bash
bun markets
```
