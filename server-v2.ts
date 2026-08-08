import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

const PORT = Number(process.env.PORT || 3000);
const CHAIN_ID = 8453;
const USDC = (process.env.BASE_USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913').toLowerCase();
const TREASURY = (process.env.BINGO_TREASURY_ADDRESS || '').trim().toLowerCase();
const RPC_URL = (process.env.BASE_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '').trim();
const PAID_ACCESS = (process.env.BINGO_PAID_ACCESS_ENABLED || 'false').toLowerCase() === 'true';
const ACCESS_PRICE_USDC = Number(process.env.BINGO_ACCESS_PRICE_USDC || '0.10');
const DATA_DIR = process.env.BINGO_DATA_DIR || '/data/bingo-v2';
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const AUDIT_PATH = path.join(DATA_DIR, 'audit.jsonl');
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

type PaymentStatus = 'pending' | 'submitted' | 'verified' | 'rejected';
type LobbyStatus = 'countdown' | 'active' | 'complete';

type Player = {
  id: string;
  username: string;
  walletAddress: string;
  points: number;
  wins: number;
  rounds: number;
  createdAt: string;
};

type LobbyPlayer = {
  playerId: string;
  username: string;
  walletAddress: string;
  card: number[][];
  selectedNumbers: number[];
};

type Lobby = {
  id: string;
  name: string;
  description: string;
  accessPriceUsdc: number;
  status: LobbyStatus;
  countdownSeconds: number;
  calledNumbers: number[];
  activePlayers: LobbyPlayer[];
  winners: string[];
  roundId: string;
  pattern: 'line' | 'four-corners' | 'blackout';
};

type Payment = {
  id: string;
  walletAddress: string;
  lobbyId: string;
  amountUsdc: number;
  status: PaymentStatus;
  txHash?: string;
  blockNumber?: string;
  reason?: string;
  createdAt: string;
  verifiedAt?: string;
  consumedAt?: string;
};

type State = {
  players: Player[];
  lobbies: Lobby[];
  payments: Payment[];
  roundHistory: Array<{
    roundId: string;
    lobbyId: string;
    winners: string[];
    calledNumbers: number[];
    completedAt: string;
  }>;
};

function freshLobby(id: string, name: string, description: string, pattern: Lobby['pattern']): Lobby {
  return {
    id,
    name,
    description,
    accessPriceUsdc: ACCESS_PRICE_USDC,
    status: 'countdown',
    countdownSeconds: 12,
    calledNumbers: [],
    activePlayers: [],
    winners: [],
    roundId: `round_${crypto.randomUUID()}`,
    pattern,
  };
}

function initialState(): State {
  return {
    players: [],
    lobbies: [
      freshLobby('signal-line', 'Signal Line', 'Fast standard-line rounds.', 'line'),
      freshLobby('corner-grid', 'Corner Grid', 'Four-corner pattern rounds.', 'four-corners'),
      freshLobby('deep-blackout', 'Deep Blackout', 'Long-form full-card challenge.', 'blackout'),
    ],
    payments: [],
    roundHistory: [],
  };
}

fs.mkdirSync(DATA_DIR, { recursive: true });
let state: State = initialState();

function persist(reason: string) {
  const tmp = `${STATE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_PATH);
  fs.appendFileSync(AUDIT_PATH, JSON.stringify({ id: crypto.randomUUID(), reason, at: new Date().toISOString() }) + '\n');
}

if (fs.existsSync(STATE_PATH)) {
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as State;
  } catch (error) {
    console.error('[bingo-v2] state restore failed; using clean state', error);
    state = initialState();
  }
} else {
  persist('bootstrap');
}

function validAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function validTxHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function normalizeAddress(value: string) {
  return value.toLowerCase();
}

function generateCard(seed: string): number[][] {
  const ranges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
  return ranges.map(([min, max], col) => {
    const values: number[] = [];
    let counter = 0;
    while (values.length < 5) {
      const digest = crypto.createHash('sha256').update(`${seed}:${col}:${counter++}`).digest();
      const value = min + (digest.readUInt32BE(0) % (max - min + 1));
      if (!values.includes(value)) values.push(value);
    }
    return values.sort((a, b) => a - b);
  });
}

function marked(card: number[][], called: number[], col: number, row: number) {
  if (col === 2 && row === 2) return true;
  return called.includes(card[col]?.[row]);
}

function hasBingo(card: number[][], called: number[], pattern: Lobby['pattern']) {
  if (pattern === 'four-corners') {
    return marked(card, called, 0, 0) && marked(card, called, 0, 4) && marked(card, called, 4, 0) && marked(card, called, 4, 4);
  }
  if (pattern === 'blackout') {
    for (let c = 0; c < 5; c++) for (let r = 0; r < 5; r++) if (!marked(card, called, c, r)) return false;
    return true;
  }
  for (let r = 0; r < 5; r++) {
    if ([0, 1, 2, 3, 4].every(c => marked(card, called, c, r))) return true;
  }
  for (let c = 0; c < 5; c++) {
    if ([0, 1, 2, 3, 4].every(r => marked(card, called, c, r))) return true;
  }
  return false;
}

async function rpc(method: string, params: unknown[]) {
  if (!RPC_URL) throw new Error('Base RPC is not configured');
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Base RPC HTTP ${response.status}`);
  const body = await response.json() as any;
  if (body.error) throw new Error(body.error.message || 'Base RPC returned an error');
  return body.result;
}

async function verifyUsdcTransfer(payment: Payment, txHash: string): Promise<Payment> {
  if (!RPC_URL || !TREASURY) throw new Error('Payment verification is not configured');
  if (state.payments.some(p => p.id !== payment.id && p.txHash?.toLowerCase() === txHash.toLowerCase() && p.status === 'verified')) {
    throw new Error('Transaction proof has already been used');
  }

  const [tx, receipt] = await Promise.all([
    rpc('eth_getTransactionByHash', [txHash]),
    rpc('eth_getTransactionReceipt', [txHash]),
  ]);
  if (!tx || !receipt) throw new Error('Transaction is not confirmed on Base yet');
  if (String(receipt.status).toLowerCase() !== '0x1') throw new Error('Transaction failed on Base');
  if (normalizeAddress(String(tx.from || '')) !== normalizeAddress(payment.walletAddress)) throw new Error('Transaction sender does not match payment owner');
  if (normalizeAddress(String(tx.to || '')) !== USDC) throw new Error('Transaction is not a USDC contract call');

  const required = BigInt(Math.round(payment.amountUsdc * 1_000_000));
  let matched = false;
  for (const log of receipt.logs || []) {
    const topics = (log.topics || []).map((v: unknown) => String(v).toLowerCase());
    if (normalizeAddress(String(log.address || '')) !== USDC || topics.length < 3 || topics[0] !== TRANSFER_TOPIC) continue;
    const from = `0x${topics[1].slice(-40)}`.toLowerCase();
    const to = `0x${topics[2].slice(-40)}`.toLowerCase();
    const amount = BigInt(String(log.data || '0x0'));
    if (from === normalizeAddress(payment.walletAddress) && to === TREASURY && amount >= required) {
      matched = true;
      break;
    }
  }
  if (!matched) throw new Error('No matching USDC Transfer to the configured treasury for the required amount');

  payment.status = 'verified';
  payment.txHash = txHash.toLowerCase();
  payment.blockNumber = receipt.blockNumber;
  payment.verifiedAt = new Date().toISOString();
  payment.reason = undefined;
  persist('payment_verified');
  return payment;
}

function publicLobby(lobby: Lobby) {
  return {
    id: lobby.id,
    name: lobby.name,
    description: lobby.description,
    accessPriceUsdc: lobby.accessPriceUsdc,
    paidAccessRequired: PAID_ACCESS,
    status: lobby.status,
    countdownSeconds: lobby.countdownSeconds,
    calledNumbers: lobby.calledNumbers,
    activePlayers: lobby.activePlayers.map(p => ({ username: p.username, walletAddress: p.walletAddress, selectedNumbers: p.selectedNumbers })),
    winners: lobby.winners,
    roundId: lobby.roundId,
    pattern: lobby.pattern,
  };
}

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'bingo-2060', version: 2, paidAccess: PAID_ACCESS, rpcConfigured: Boolean(RPC_URL), treasuryConfigured: Boolean(TREASURY), at: new Date().toISOString() });
});

app.get('/.well-known/x402.json', (_req, res) => {
  res.json({
    x402Version: 2,
    service: 'Bingo 2060',
    network: `eip155:${CHAIN_ID}`,
    asset: USDC,
    paidAccessEnabled: PAID_ACCESS,
    payTo: TREASURY || null,
    priceUsdc: ACCESS_PRICE_USDC,
    note: 'x402 is used for verified session/lobby access. Game results award points and history, not automatic cash payouts.',
  });
});

app.get('/api/state', (_req, res) => {
  res.json({
    service: 'Bingo 2060',
    version: 2,
    paidAccessEnabled: PAID_ACCESS,
    lobbies: state.lobbies.map(publicLobby),
    verifiedPayments: state.payments.filter(p => p.status === 'verified').length,
    roundsCompleted: state.roundHistory.length,
    generatedAt: new Date().toISOString(),
  });
});

app.get('/api/lobbies', (_req, res) => {
  res.json({ lobbies: state.lobbies.map(publicLobby) });
});

app.get('/api/leaderboard', (_req, res) => {
  const leaders = [...state.players]
    .sort((a, b) => b.points - a.points || b.wins - a.wins)
    .slice(0, 50)
    .map(({ username, walletAddress, points, wins, rounds }) => ({ username, walletAddress, points, wins, rounds }));
  res.json({ leaders });
});

app.post('/api/auth/login', (req, res) => {
  const { username, walletAddress } = req.body || {};
  if (typeof username !== 'string' || username.trim().length < 2 || username.trim().length > 40 || !validAddress(walletAddress)) {
    return res.status(400).json({ error: 'A display name and valid Base wallet address are required.' });
  }
  const normalized = normalizeAddress(walletAddress);
  let player = state.players.find(p => normalizeAddress(p.walletAddress) === normalized);
  if (!player) {
    player = { id: crypto.randomUUID(), username: username.trim(), walletAddress, points: 0, wins: 0, rounds: 0, createdAt: new Date().toISOString() };
    state.players.push(player);
    persist('player_created');
  }
  return res.json({ status: 'authenticated', player });
});

app.post('/api/payments/prepare', (req, res) => {
  if (!PAID_ACCESS) return res.status(409).json({ error: 'Paid access is disabled; no payment is required.' });
  if (!TREASURY || !RPC_URL) return res.status(503).json({ error: 'Paid access is enabled but payment verification is not fully configured.' });

  const { lobbyId, walletAddress } = req.body || {};
  const lobby = state.lobbies.find(l => l.id === lobbyId);
  if (!lobby || !validAddress(walletAddress)) return res.status(400).json({ error: 'Valid lobbyId and walletAddress are required.' });

  let payment = state.payments.find(p => p.lobbyId === lobbyId && normalizeAddress(p.walletAddress) === normalizeAddress(walletAddress) && p.status === 'pending');
  if (!payment) {
    payment = { id: crypto.randomUUID(), walletAddress, lobbyId, amountUsdc: lobby.accessPriceUsdc, status: 'pending', createdAt: new Date().toISOString() };
    state.payments.push(payment);
    persist('payment_prepared');
  }

  return res.json({
    payment,
    send: { chainId: CHAIN_ID, tokenContract: USDC, payTo: TREASURY, amountUsdc: payment.amountUsdc, decimals: 6 },
  });
});

app.post('/api/payments/confirm', async (req, res) => {
  const { paymentId, txHash } = req.body || {};
  const payment = state.payments.find(p => p.id === paymentId);
  if (!payment || !validTxHash(txHash)) return res.status(400).json({ error: 'Valid paymentId and txHash are required.' });
  if (payment.status === 'verified') return res.json({ payment });

  payment.txHash = txHash.toLowerCase();
  payment.status = 'submitted';
  persist('payment_submitted');
  try {
    await verifyUsdcTransfer(payment, txHash);
    return res.json({ payment });
  } catch (error: any) {
    payment.status = /not confirmed/i.test(error?.message || '') ? 'submitted' : 'rejected';
    payment.reason = error?.message || 'Payment verification failed';
    persist('payment_verification_failed');
    return res.status(payment.status === 'submitted' ? 202 : 422).json({ payment });
  }
});

app.post('/api/lobbies/join', (req, res) => {
  const { lobbyId, walletAddress, username, paymentId } = req.body || {};
  const lobby = state.lobbies.find(l => l.id === lobbyId);
  if (!lobby || !validAddress(walletAddress) || typeof username !== 'string') return res.status(400).json({ error: 'Valid lobby, wallet and username are required.' });

  if (PAID_ACCESS) {
    const payment = state.payments.find(p => p.id === paymentId && p.lobbyId === lobbyId && normalizeAddress(p.walletAddress) === normalizeAddress(walletAddress));
    if (!payment || payment.status !== 'verified' || payment.consumedAt) {
      return res.status(402).json({ error: 'A verified, unused x402 payment is required for this lobby.', priceUsdc: lobby.accessPriceUsdc });
    }
    payment.consumedAt = new Date().toISOString();
  }

  const player = state.players.find(p => normalizeAddress(p.walletAddress) === normalizeAddress(walletAddress));
  if (!player) return res.status(401).json({ error: 'Create a player session first.' });

  if (!lobby.activePlayers.some(p => normalizeAddress(p.walletAddress) === normalizeAddress(walletAddress))) {
    lobby.activePlayers.push({
      playerId: player.id,
      username: player.username,
      walletAddress: player.walletAddress,
      card: generateCard(`${lobby.roundId}:${player.walletAddress}`),
      selectedNumbers: [],
    });
    persist('lobby_joined');
  }
  return res.json({ success: true, lobby: publicLobby(lobby) });
});

app.get('/api/rounds/history', (_req, res) => {
  res.json({ rounds: state.roundHistory.slice(-100).reverse() });
});

setInterval(() => {
  let dirty = false;
  for (const lobby of state.lobbies) {
    if (lobby.status === 'countdown') {
      lobby.countdownSeconds -= 1;
      dirty = true;
      if (lobby.countdownSeconds <= 0) {
        lobby.status = 'active';
        lobby.calledNumbers = [];
        lobby.winners = [];
      }
      continue;
    }

    if (lobby.status === 'active') {
      if (lobby.activePlayers.length === 0) {
        lobby.status = 'complete';
        dirty = true;
        continue;
      }
      const remaining = Array.from({ length: 75 }, (_, i) => i + 1).filter(n => !lobby.calledNumbers.includes(n));
      if (remaining.length === 0) {
        lobby.status = 'complete';
        dirty = true;
        continue;
      }
      const next = remaining[crypto.randomInt(remaining.length)];
      lobby.calledNumbers.push(next);
      for (const player of lobby.activePlayers) {
        if (player.card.flat().includes(next) && !player.selectedNumbers.includes(next)) player.selectedNumbers.push(next);
      }
      const winners = lobby.activePlayers.filter(p => hasBingo(p.card, lobby.calledNumbers, lobby.pattern));
      if (winners.length) {
        lobby.winners = winners.map(w => w.username);
        lobby.status = 'complete';
        for (const winner of winners) {
          const player = state.players.find(p => p.id === winner.playerId);
          if (player) {
            player.points += 100;
            player.wins += 1;
          }
        }
        for (const participant of lobby.activePlayers) {
          const player = state.players.find(p => p.id === participant.playerId);
          if (player) player.rounds += 1;
        }
      }
      dirty = true;
      continue;
    }

    if (lobby.status === 'complete') {
      state.roundHistory.push({ roundId: lobby.roundId, lobbyId: lobby.id, winners: lobby.winners, calledNumbers: [...lobby.calledNumbers], completedAt: new Date().toISOString() });
      if (state.roundHistory.length > 500) state.roundHistory = state.roundHistory.slice(-500);
      const replacement = freshLobby(lobby.id, lobby.name, lobby.description, lobby.pattern);
      Object.assign(lobby, replacement);
      dirty = true;
    }
  }
  if (dirty) persist('round_tick');
}, 1500);

async function serveFrontend() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(process.cwd(), 'dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
}

serveFrontend().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`[bingo-2060] v2 listening on 0.0.0.0:${PORT}`));
});
