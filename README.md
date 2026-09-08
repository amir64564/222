# x-ca-auto-buyer v2

Base-only CA-first X watcher/executor. The post itself does **not** need a ticker or token name. A valid EVM CA is extracted first, then Base is the authority for `name()`, `symbol()`, and `decimals()`.

## Pipeline

`X post -> post dedupe -> CA extraction -> CA dedupe -> parallel Base RPC reads -> TARGET_TICKER/TARGET_NAME match -> non-blocking Telegram alert -> optional direct Uniswap V3 execution`

The X watcher is modular behind `IXWatcher`:

- `X_WATCHER_MODE=api`: official X API v2 recent search, filtered to the configured username.
- `X_WATCHER_MODE=cookie`: X web GraphQL using `X_AUTH_TOKEN` + `X_CT0`, polled every `POLL_INTERVAL_MS`.

Cookie mode uses undocumented X web endpoints/query IDs; X can rotate them or change authentication behavior, so this driver can break without notice. The bundled query IDs are intended as a practical starting point, not a stability guarantee.

## Base execution

The trader uses Uniswap V3 `SwapRouter02` directly on Base. The router is the official Base deployment `0x2626664c2603336E57B271c5C0b26F421741e481`, and the Base `QuoterV2` is `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a`. It checks the configured 1% fee-tier pool, quotes the exact ETH input, applies runtime slippage to `amountOutMinimum`, and calls `exactInputSingle` with native ETH attached so the router can wrap it as WETH.

`DRY_RUN=true` and `AUTO_BUY=false` are the defaults. Telegram `/stop` and `/resume` change only the runtime execution kill switch; X monitoring and verification stay active.

## Install

```bash
npm install
cp .env.example .env
npm run build
npm start
```

## Telegram

Supported commands/messages:

- `/stop` or `STOP`
- `/resume` or `RESUME`
- `SLIPPAGE 20%`
- `/status`

Telegram dispatch is an in-memory asynchronous queue. CA extraction, Base verification, and the buy path do not await Telegram sends.

## Security

Never commit `.env` or a real private key. Start in dry-run mode. A direct on-chain transaction can still fail because a pool can be newly created, illiquid, manipulated, or incompatible with the chosen fee tier/slippage.
