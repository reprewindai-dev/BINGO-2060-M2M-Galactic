# Bingo 2060 — M2M Galactic

A standalone Veklom-built multiplayer game experiment for machine-to-machine identity, verifiable rounds, and payment-gated participation.

This product is intentionally **separate from the Veklom Capability OS workspace**. It can consume Veklom identity, x402, and evidence services, but it keeps its own product runtime and can be operated, licensed, or sold independently.

## User value

The product should make every round easy to understand and easy to trust:

- enter a lobby,
- receive a deterministic card/round state,
- follow the draw in real time,
- see why a result won or lost,
- inspect the round/payment evidence,
- build history, achievements, and social reputation over time.

Repeat use should come from progression, transparent competition, collectible history, social play, and verifiable outcomes.

## Production boundary

The repository contains seeded players/bots and bootstrap accounting used to make local development usable. Those values are fixtures, not verified production balances, users, winnings, or treasury state.

Production surfaces must not present seeded state as live. Monetary settlement and prize mechanics must be backed by real payment verification and an appropriate production/legal configuration; otherwise the game should operate in non-cash/demo mode.

## Runtime

```bash
npm install
npm run dev
```

The server persists runtime snapshots and audit events under `BINGO_LEDGER_DIR`. Secrets and payment credentials belong in the deployment environment and must never be committed to git.
