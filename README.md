# polybot

Bun is required to run this project. You can install it from [here](https://bun.sh/).

Alchemy RPC Token is required to run this project, you can aquire it [here](https://www.alchemy.com/).

```bash
bun install
```

prepare the environment variables copy `.env.example` to `.env` and fill in the values.
this generates a new keypair

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
