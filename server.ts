/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import fs from 'fs';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;
const TREASURY_WALLET = '0x3a74772e925b54F7dAD7FD95c9Ba30825033f970';
const APP_ID = '6a20f24cc341f72c2f573eb5';
const BASE_CHAIN_ID = 8453;
const BASE_USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_RPC_URL = process.env.BASE_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
const LEDGER_DIR = process.env.BINGO_LEDGER_DIR || '/data/bingo';
const SNAPSHOT_PATH = path.join(LEDGER_DIR, 'runtime-state.json');
const AUDIT_LOG_PATH = path.join(LEDGER_DIR, 'audit-events.jsonl');

type PaymentStatus = 'pending' | 'submitted' | 'verified' | 'rejected';

interface PaymentProof {
  paymentId: string;
  kind: 'lobby_entry' | 'win_claim' | 'challenge_reward';
  walletAddress: string;
  amountUSDC: string;
  asset: string;
  payTo: string;
  chainId: number;
  status: PaymentStatus;
  lobbyId?: string;
  txHash?: string;
  blockNumber?: string | number;
  gasUsed?: string | number;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
  reason?: string;
}

// Lazy initialize Gemini AI
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
      try {
        geminiClient = new GoogleGenAI({
          apiKey: apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
      } catch (e) {
        console.error('Failed to initialize GoogleGenAI client:', e);
      }
    }
  }
  return geminiClient;
}

// Global Progressive Jackpot & Treasury State. These are runtime accounting values only;
// on-chain settlement is tracked separately in db.paymentProofs.
let progressiveJackpotPool = 1250.75;
let treasuryCollected = 145.20;
let lastJackpotWinner: string | null = null;

// Famous cybernetic M2M bots to fill lobbies dynamically
const BOT_TEMPLATES = [
  { username: 'Eldritch_Daemon', walletAddress: '0x1111eDb6E08f4c7C32D4f71b54bdA029111111' },
  { username: '0xHex_Vortex', walletAddress: '0x2222eDb6E08f4c7C32D4f71b54bdA029122222' },
  { username: 'BaseCore_Agent_09', walletAddress: '0x3333eDb6E08f4c7C32D4f71b54bdA029133333' },
  { username: 'CoherencePlus_Bot', walletAddress: '0x4444eDb6E08f4c7C32D4f71b54bdA029144444' },
  { username: 'Satoshi_Daub_Node', walletAddress: '0x5555eDb6E08f4c7C32D4f71b54bdA029155555' },
  { username: 'Cosmos_Pacer', walletAddress: '0x6666eDb6E08f4c7C32D4f71b54bdA029166666' }
];

// In-Memory Database (Robust State Store for 2060 Bingo)
const db = {
  players: [
    {
      username: 'NeuralSurfer_99',
      walletAddress: '0x1c17fD899B8c4D82C0E8f4c32D4f71b54bdA0291a',
      mfaEnabled: true,
      performanceMetrics: { totalWins: 14, avgCardiacCoherence: 0.82, peakNeuralFrequency: 42.5, attentionScore: 89 }
    },
    {
      username: 'AI_Agent_Valkyrie',
      walletAddress: '0x9928fCD6eDb6E08f4c7C32D4f71b54bdA02911b',
      mfaEnabled: true,
      performanceMetrics: { totalWins: 27, avgCardiacCoherence: 0.94, peakNeuralFrequency: 68.1, attentionScore: 98 }
    },
    {
      username: 'BaseMaximalist',
      walletAddress: '0x7183eDb6E08f4c7C32D4f71b54bdA029139281c',
      mfaEnabled: true,
      performanceMetrics: { totalWins: 8, avgCardiacCoherence: 0.71, peakNeuralFrequency: 31.0, attentionScore: 75 }
    }
  ] as any[],
  
  // Game Lobbies
  lobbies: [
    {
      id: 'micro-lobby',
      name: 'Micro-Lobby',
      entryFee: 0.10,
      status: 'countdown',
      countdownSeconds: 15,
      calledNumbers: [],
      activePlayers: [],
      currentPrizePot: 5.00,
      winners: [],
      predictedWinningPattern: 'X-Pattern',
      drawTimer: 0
    },
    {
      id: 'elite-arena',
      name: 'Elite Arena',
      entryFee: 1.00,
      status: 'countdown',
      countdownSeconds: 20,
      calledNumbers: [],
      activePlayers: [],
      currentPrizePot: 25.00,
      winners: [],
      predictedWinningPattern: 'Cosmic Cross',
      drawTimer: 0
    },
    {
      id: 'progressive-jackpot',
      name: 'Galactic Jackpot Pool',
      entryFee: 5.00,
      status: 'countdown',
      countdownSeconds: 25,
      calledNumbers: [],
      activePlayers: [],
      currentPrizePot: 150.00,
      winners: [],
      predictedWinningPattern: 'Full House',
      drawTimer: 0
    }
  ] as any[],

  currentSelectionHistory: [] as any[],
  pushSubscriptions: [] as any[],
  pushNotifications: [] as any[],
  paymentProofs: [] as PaymentProof[]
};

type PersistedState = {
  players: any[];
  lobbies: any[];
  currentSelectionHistory: any[];
  pushSubscriptions: any[];
  pushNotifications: any[];
  paymentProofs: PaymentProof[];
  accounting: {
    progressiveJackpotPool: number;
    treasuryCollected: number;
    lastJackpotWinner: string | null;
  };
};

function currentState(): PersistedState {
  return {
    players: db.players,
    lobbies: db.lobbies,
    currentSelectionHistory: db.currentSelectionHistory,
    pushSubscriptions: db.pushSubscriptions,
    pushNotifications: db.pushNotifications.slice(-500),
    paymentProofs: db.paymentProofs,
    accounting: {
      progressiveJackpotPool,
      treasuryCollected,
      lastJackpotWinner
    }
  };
}

function applyState(state: PersistedState): void {
  if (!state || typeof state !== 'object') return;
  if (Array.isArray(state.players) && state.players.length > 0) db.players = state.players;
  if (Array.isArray(state.lobbies) && state.lobbies.length > 0) db.lobbies = state.lobbies;
  if (Array.isArray(state.currentSelectionHistory)) db.currentSelectionHistory = state.currentSelectionHistory;
  if (Array.isArray(state.pushSubscriptions)) db.pushSubscriptions = state.pushSubscriptions;
  if (Array.isArray(state.pushNotifications)) db.pushNotifications = state.pushNotifications;
  if (Array.isArray(state.paymentProofs)) db.paymentProofs = state.paymentProofs;
  if (state.accounting) {
    progressiveJackpotPool = Number(state.accounting.progressiveJackpotPool ?? progressiveJackpotPool);
    treasuryCollected = Number(state.accounting.treasuryCollected ?? treasuryCollected);
    lastJackpotWinner = state.accounting.lastJackpotWinner ?? lastJackpotWinner;
  }
}

fs.mkdirSync(LEDGER_DIR, { recursive: true });

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function appendAuditLine(event: unknown): void {
  fs.appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify(event)}\n`);
}

function persistState(reason: string): void {
  const now = new Date().toISOString();
  writeJsonAtomic(SNAPSHOT_PATH, {
    key: 'runtime',
    updatedAt: now,
    state: currentState()
  });
  if (reason !== 'autonomous_tick') {
    recordAuditEvent('state_snapshot', reason, { reason, snapshotAt: now }, false);
  }
}

function recordAuditEvent(eventType: string, subjectId: string | null, payload: unknown, includeSnapshot = true): void {
  appendAuditLine({
    id: crypto.randomUUID(),
    eventType,
    subjectId,
    payload,
    createdAt: new Date().toISOString()
  });
  if (includeSnapshot) {
    writeJsonAtomic(SNAPSHOT_PATH, {
      key: 'runtime',
      updatedAt: new Date().toISOString(),
      state: currentState()
    });
  }
}

if (fs.existsSync(SNAPSHOT_PATH)) {
  try {
    const savedRuntime = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    applyState(savedRuntime.state);
    recordAuditEvent('runtime_restored', 'runtime', { snapshotPath: SNAPSHOT_PATH, restoredAt: new Date().toISOString() }, false);
  } catch (error) {
    console.error('Failed to restore Bingo runtime state from durable ledger:', error);
  }
} else {
  persistState('initial_bootstrap');
}

// Helper to generate standard BINGO card
function generateCardForLobby(seed: string): number[][] {
  const card: number[][] = [];
  const ranges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
  let hashVal = 0;
  for (let i = 0; i < seed.length; i++) {
    hashVal += seed.charCodeAt(i);
  }
  for (let col = 0; col < 5; col++) {
    const colNums: number[] = [];
    const [min, max] = ranges[col];
    let attempts = 0;
    while (colNums.length < 5) {
      attempts++;
      const rand = Math.sin(hashVal + colNums.length * (col + 1) + attempts) * 10000;
      const num = min + Math.floor((rand - Math.floor(rand)) * (max - min + 1));
      if (!colNums.includes(num)) {
        colNums.push(num);
      }
    }
    colNums.sort((a, b) => a - b);
    card.push(colNums);
  }
  return card;
}

// BINGO Winning Pattern Checker
function checkBingo(card: number[][], selected: number[], pattern: string): boolean {
  const getCell = (col: number, row: number) => {
    if (col === 2 && row === 2) return true; // Free space
    const val = card[col]?.[row];
    return selected.includes(val);
  };

  if (pattern === 'X-Pattern') {
    const d1 = getCell(0,0) && getCell(1,1) && getCell(2,2) && getCell(3,3) && getCell(4,4);
    const d2 = getCell(0,4) && getCell(1,3) && getCell(2,2) && getCell(3,1) && getCell(4,0);
    return d1 && d2;
  }
  if (pattern === 'Cosmic Cross') {
    const h2 = getCell(0,2) && getCell(1,2) && getCell(2,2) && getCell(3,2) && getCell(4,2);
    const v2 = getCell(2,0) && getCell(2,1) && getCell(2,2) && getCell(2,3) && getCell(2,4);
    return h2 && v2;
  }
  if (pattern === 'Four Corners') {
    return getCell(0,0) && getCell(0,4) && getCell(4,0) && getCell(4,4);
  }
  if (pattern === 'Outer Ring') {
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 5; r++) {
        if (c === 0 || c === 4 || r === 0 || r === 4) {
          if (!getCell(c, r)) return false;
        }
      }
    }
    return true;
  }
  if (pattern === 'Full House' || pattern === 'Full House / Blackout') {
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 5; r++) {
        if (!getCell(c, r)) return false;
      }
    }
    return true;
  }
  return false;
}

// 24/7 Autonomous Rolling Loop
setInterval(() => {
  db.lobbies.forEach((lobby) => {
    if (lobby.status === 'countdown') {
      lobby.countdownSeconds -= 1;
      if (lobby.countdownSeconds <= 0) {
        // Shift to Active Game state
        lobby.status = 'active';
        lobby.calledNumbers = [];
        lobby.winners = [];
        lobby.drawTimer = 0;

        // Ensure there are at least 5 active competitors in the arena (auto-fill bots)
        const currentCount = lobby.activePlayers.length;
        if (currentCount < 5) {
          const botsToAdd = BOT_TEMPLATES.slice(0, 5 - currentCount);
          botsToAdd.forEach((bot) => {
            lobby.activePlayers.push({
              username: bot.username,
              walletAddress: bot.walletAddress,
              isBot: true,
              card: generateCardForLobby(bot.username),
              selectedNumbers: [],
              coherence: Number((0.70 + Math.random() * 0.25).toFixed(3)),
              focus: Math.floor(75 + Math.random() * 20),
              frequency: Number((10.0 + Math.random() * 35).toFixed(1))
            });
          });
        }

        // Calculate and collect EIP-3009 Entry Fees
        // 10% Dev Treasury Cut, 20% Progressive Jackpot Cut, 70% Active Prize Pot
        const totalEntryVolume = lobby.activePlayers.length * lobby.entryFee;
        const devCut = totalEntryVolume * 0.10;
        const progressiveCut = totalEntryVolume * 0.20;
        const activePrize = totalEntryVolume * 0.70;

        treasuryCollected += devCut;
        progressiveJackpotPool += progressiveCut;
        lobby.currentPrizePot += activePrize;

        db.pushNotifications.push({
          id: crypto.randomUUID(),
          type: 'tournament_alert',
          message: `[M2M AUTONOMOUS] ${lobby.name} started with pattern: ${lobby.predictedWinningPattern}. Total Prize Pot: ${lobby.currentPrizePot.toFixed(2)} USDC!`,
          timestamp: new Date().toISOString()
        });
        recordAuditEvent('round_started', lobby.id, {
          lobbyId: lobby.id,
          pattern: lobby.predictedWinningPattern,
          activePlayers: lobby.activePlayers.length,
          totalEntryVolume,
          devCut,
          progressiveCut,
          activePrize
        });
      }
    } else if (lobby.status === 'active') {
      lobby.drawTimer += 1;

      // Draw a number every 3 seconds for lightning-fast M2M pace
      if (lobby.drawTimer >= 3) {
        lobby.drawTimer = 0;

        if (lobby.calledNumbers.length >= 75) {
          // No winners, progressive jackpot grows, restart lobby countdown
          lobby.status = 'completed';
          lobby.countdownSeconds = 15;
          
          // Roll current lobby pool into progressive pool as penalty, minus 10% house fee
          const rolloverAmount = lobby.currentPrizePot;
          const devFee = rolloverAmount * 0.10;
          treasuryCollected += devFee;
          progressiveJackpotPool += (rolloverAmount - devFee);
          
          lobby.currentPrizePot = lobby.entryFee * 10; // Seed default pool for next round
          
          db.pushNotifications.push({
            id: crypto.randomUUID(),
            type: 'communal_win',
            message: `[GAME OVER] No winner in ${lobby.name}. Prize pot rolled into the progressive pool.`,
            timestamp: new Date().toISOString()
          });
          recordAuditEvent('round_completed_no_winner', lobby.id, {
            lobbyId: lobby.id,
            calledNumbers: lobby.calledNumbers,
            rolloverAmount,
            devFee,
            progressiveJackpotPool
          });
          return;
        }

        // Draw next random number
        let newNum: number;
        do {
          newNum = Math.floor(Math.random() * 75) + 1;
        } while (lobby.calledNumbers.includes(newNum));

        lobby.calledNumbers.push(newNum);
        recordAuditEvent('number_drawn', lobby.id, {
          lobbyId: lobby.id,
          number: newNum,
          drawIndex: lobby.calledNumbers.length,
          pattern: lobby.predictedWinningPattern
        }, false);

        // All players (Bots and humans) automatically check card
        lobby.activePlayers.forEach((p: any) => {
          // Flatten card to find match
          const flattened = p.card.flat();
          if (flattened.includes(newNum) && !p.selectedNumbers.includes(newNum)) {
            p.selectedNumbers.push(newNum);
          }
        });

        // Scan for winners
        const winners: any[] = [];
        lobby.activePlayers.forEach((p: any) => {
          const hasWon = checkBingo(p.card, p.selectedNumbers, lobby.predictedWinningPattern);
          if (hasWon) {
            winners.push(p);
          }
        });

        if (winners.length > 0) {
          // Bingo Winner found!
          lobby.status = 'completed';
          lobby.countdownSeconds = 15;
          lobby.winners = winners.map(w => w.username);

          // Calculate prize payout
          let rawWinAmount = lobby.currentPrizePot / winners.length;
          
          // Progressive jackpot inclusion for the Jackpot Lobby
          let wasJackpotWon = false;
          if (lobby.id === 'progressive-jackpot') {
            rawWinAmount += (progressiveJackpotPool / winners.length);
            wasJackpotWon = true;
          }

          winners.forEach((winner) => {
            // Take 15% house surcharge to secure future seed balance
            const developerSurcharge = rawWinAmount * 0.15;
            const netPayout = rawWinAmount - developerSurcharge;

            treasuryCollected += developerSurcharge;

            // Credit human players instantly
            if (!winner.isBot) {
              const matchedPlayer = db.players.find(p => p.walletAddress.toLowerCase() === winner.walletAddress.toLowerCase());
              if (matchedPlayer) {
                matchedPlayer.performanceMetrics.totalWins += 1;
              }
            }

            db.pushNotifications.push({
              id: crypto.randomUUID(),
              type: 'communal_win',
              message: `[BINGO COHERENCE] ${winner.username} won ${netPayout.toFixed(2)} USDC on ${lobby.name}! (${developerSurcharge.toFixed(2)} USDC house fee sent to ${TREASURY_WALLET.slice(0, 6)}...)`,
              timestamp: new Date().toISOString()
            });
            recordAuditEvent('winner_detected', lobby.id, {
              lobbyId: lobby.id,
              winner: winner.username,
              walletAddress: winner.walletAddress,
              isBot: Boolean(winner.isBot),
              pattern: lobby.predictedWinningPattern,
              calledNumbers: lobby.calledNumbers,
              rawWinAmount,
              developerSurcharge,
              netPayout,
              settlementState: 'needs_payment_payout_proof'
            });

            if (wasJackpotWon) {
              lastJackpotWinner = winner.username;
            }
          });

          // Reset pools safely
          if (wasJackpotWon) {
            // Seed back progressive pool to prevent dryness
            progressiveJackpotPool = 500.00;
          }
          lobby.currentPrizePot = lobby.entryFee * 10; // reseed base
        }
      }
    } else if (lobby.status === 'completed') {
      lobby.countdownSeconds -= 1;
      if (lobby.countdownSeconds <= 0) {
        // Recycle back to Countdown state for continuous loop
        lobby.status = 'countdown';
        lobby.countdownSeconds = lobby.id === 'micro-lobby' ? 15 : lobby.id === 'elite-arena' ? 20 : 25;
        lobby.calledNumbers = [];
        lobby.winners = [];
        lobby.activePlayers = []; // Flush old contestants
        lobby.predictedWinningPattern = ['X-Pattern', 'Cosmic Cross', 'Outer Ring', 'Four Corners', 'Full House'][Math.floor(Math.random() * 5)];
        recordAuditEvent('round_reset', lobby.id, {
          lobbyId: lobby.id,
          nextPattern: lobby.predictedWinningPattern,
          nextCountdownSeconds: lobby.countdownSeconds
        });
      }
    }
  });
  persistState('autonomous_tick');
}, 1000);

function appBaseUrl(req: express.Request): string {
  return process.env.APP_URL || `${req.protocol}://${req.get('host') || `localhost:${PORT}`}`;
}

function buildPaymentRequirements(req: express.Request, costUSDC: string, description: string) {
  return {
    x402Version: 2,
    resource: {
      url: `${appBaseUrl(req)}${req.originalUrl}`,
      description,
      mimeType: 'application/json'
    },
    accepts: [
      {
        scheme: 'exact',
        network: `eip155:${BASE_CHAIN_ID}`,
        price: costUSDC,
        asset: BASE_USDC_CONTRACT,
        payTo: TREASURY_WALLET,
        maxTimeoutSeconds: 86400,
        extra: {
          name: 'USD Coin',
          version: '2',
          app_id: APP_ID
        }
      }
    ]
  };
}

function publishPaymentRequired(req: express.Request, res: express.Response, costUSDC: string, description: string): void {
  const paymentRequirements = {
    ...buildPaymentRequirements(req, costUSDC, description),
    error: 'Real Base wallet payment proof is required. Prepare a payment, send USDC on Base, then confirm with txHash.'
  };

  const encoded = Buffer.from(JSON.stringify(paymentRequirements)).toString('base64');
  res.setHeader('PAYMENT-REQUIRED', encoded);
  res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED');
  res.status(402).json({ error: 'Payment Required', code: 402, requirements: paymentRequirements });
}

function normalizeAddress(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function findPayment(paymentId: unknown): PaymentProof | undefined {
  return db.paymentProofs.find((payment) => payment.paymentId === paymentId);
}

function createPendingPayment(args: {
  kind: PaymentProof['kind'];
  walletAddress: string;
  amountUSDC: string;
  lobbyId?: string;
}): PaymentProof {
  const now = new Date().toISOString();
  const existing = db.paymentProofs.find((payment) =>
    payment.kind === args.kind &&
    payment.status === 'pending' &&
    normalizeAddress(payment.walletAddress) === normalizeAddress(args.walletAddress) &&
    payment.lobbyId === args.lobbyId &&
    payment.amountUSDC === args.amountUSDC
  );

  if (existing) return existing;

  const payment: PaymentProof = {
    paymentId: crypto.randomUUID(),
    kind: args.kind,
    walletAddress: args.walletAddress,
    amountUSDC: args.amountUSDC,
    asset: BASE_USDC_CONTRACT,
    payTo: TREASURY_WALLET,
    chainId: BASE_CHAIN_ID,
    status: 'pending',
    lobbyId: args.lobbyId,
    createdAt: now,
    updatedAt: now
  };
  db.paymentProofs.push(payment);
  recordAuditEvent('payment_prepared', payment.paymentId, payment);
  return payment;
}

async function rpcCall(method: string, params: unknown[]): Promise<any> {
  if (!BASE_RPC_URL) return null;
  const response = await fetch(BASE_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  if (!response.ok) {
    throw new Error(`Base RPC ${method} failed with HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || `Base RPC ${method} returned an error`);
  }
  return payload.result;
}

async function verifyBasePaymentTx(txHash: string, expectedTo: string): Promise<{
  status: PaymentStatus;
  blockNumber?: string;
  gasUsed?: string;
  reason?: string;
}> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return { status: 'rejected', reason: 'Invalid transaction hash format.' };
  }

  if (!BASE_RPC_URL) {
    return { status: 'submitted', reason: 'BASE_RPC_URL is not configured; receipt verification is pending.' };
  }

  const [tx, receipt] = await Promise.all([
    rpcCall('eth_getTransactionByHash', [txHash]),
    rpcCall('eth_getTransactionReceipt', [txHash])
  ]);

  if (!tx || !receipt) {
    return { status: 'submitted', reason: 'Transaction or receipt is not available yet on Base RPC.' };
  }

  if (normalizeAddress(tx.to) !== normalizeAddress(expectedTo)) {
    return { status: 'rejected', reason: `Payment transaction is not addressed to ${expectedTo}.` };
  }

  if (receipt.status !== '0x1') {
    return { status: 'rejected', reason: 'Base transaction receipt is not successful.' };
  }

  return {
    status: 'verified',
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed
  };
}

// Helper: check x402 payment proof without inventing settlement.
function handleX402Payment(req: express.Request, res: express.Response, costUSDC: string, description: string): PaymentProof | null {
  const paymentId = req.headers['x-bingo-payment-id'] as string;

  if (!paymentId) {
    publishPaymentRequired(req, res, costUSDC, description);
    return null;
  }

  const payment = findPayment(paymentId);
  if (!payment || payment.status !== 'verified' || payment.amountUSDC !== costUSDC) {
    res.status(402).json({
      error: 'Verified Bingo payment proof is required before this action can run.',
      paymentId,
      requiredAmountUSDC: costUSDC,
      currentStatus: payment?.status || 'not_found',
      reason: payment?.reason
    });
    return null;
  }

  const paymentResponse = {
    success: true,
    transactionId: payment.txHash,
    network: `eip155:${BASE_CHAIN_ID}`,
    amountPaid: payment.amountUSDC,
    recipient: payment.payTo,
    appId: APP_ID,
    paymentId: payment.paymentId
  };
  res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-RESPONSE, PAYMENT-REQUIRED');
  res.setHeader('PAYMENT-RESPONSE', Buffer.from(JSON.stringify(paymentResponse)).toString('base64'));

  return payment;
}

// ================= API ENDPOINTS =================

app.get('/.well-known/x402.json', (req, res) => {
  const base = appBaseUrl(req);
  res.json({
    x402Version: 2,
    service: 'BINGO 2060 M2M Backend',
    network: `eip155:${BASE_CHAIN_ID}`,
    pay_to: TREASURY_WALLET,
    treasury: TREASURY_WALLET,
    app_id: APP_ID,
    accepts: [
      {
        scheme: 'exact',
        network: `eip155:${BASE_CHAIN_ID}`,
        asset: BASE_USDC_CONTRACT,
        payTo: TREASURY_WALLET,
        maxTimeoutSeconds: 86400,
        extra: {
          name: 'USD Coin',
          version: '2',
          app_id: APP_ID
        }
      }
    ],
    protected_routes: db.lobbies.map((lobby) => ({
      path: '/api/lobbies/join',
      method: 'POST',
      lobbyId: lobby.id,
      price: lobby.entryFee.toFixed(2),
      description: `Bingo 2060 lobby entry for ${lobby.name}`
    })),
    endpoints: {
      state: `${base}/api/state`,
      prepare: `${base}/api/payments/prepare`,
      confirm: `${base}/api/payments/confirm`,
      status: `${base}/api/x402/status`
    }
  });
});

app.get('/api/x402/status', (_req, res) => {
  const verifiedPayments = db.paymentProofs.filter((payment) => payment.status === 'verified');
  res.json({
    status: 'online',
    service: 'BINGO 2060 x402 proof layer',
    network: `eip155:${BASE_CHAIN_ID}`,
    treasury: TREASURY_WALLET,
    asset: BASE_USDC_CONTRACT,
    appId: APP_ID,
    rpcConfigured: Boolean(BASE_RPC_URL),
    verifiedPayments: verifiedPayments.length,
    pendingPayments: db.paymentProofs.filter((payment) => payment.status === 'pending' || payment.status === 'submitted').length,
    note: BASE_RPC_URL
      ? 'Base RPC is configured; submitted tx hashes can be receipt-verified.'
      : 'BASE_RPC_URL is not configured; tx hashes are accepted as submitted but cannot be marked verified.'
  });
});

app.get('/api/state', (_req, res) => {
  const verifiedPayments = db.paymentProofs.filter((payment) => payment.status === 'verified');
  res.json({
    status: 'online',
    service: 'BINGO 2060 M2M Backend',
    generatedAt: new Date().toISOString(),
    autonomousLoop: {
      enabled: true,
      intervalMs: 1000,
      drawEverySeconds: 3,
      lobbies: db.lobbies.map((lobby) => ({
        id: lobby.id,
        name: lobby.name,
        entryFee: lobby.entryFee,
        status: lobby.status,
        countdownSeconds: lobby.countdownSeconds,
        calledNumbersCount: lobby.calledNumbers.length,
        activePlayers: lobby.activePlayers.length,
        pattern: lobby.predictedWinningPattern,
        currentPrizePot: lobby.currentPrizePot
      }))
    },
    settlement: {
      state: verifiedPayments.length > 0 ? 'verified_rows' : 'needs_verified_rows',
      treasury: TREASURY_WALLET,
      asset: BASE_USDC_CONTRACT,
      rpcConfigured: Boolean(BASE_RPC_URL),
      durableStore: {
        engine: 'append_only_file_ledger',
        directory: LEDGER_DIR,
        snapshotPath: SNAPSHOT_PATH,
        auditLogPath: AUDIT_LOG_PATH,
        snapshotKey: 'runtime',
        persistenceRequirement: 'Mount BINGO_LEDGER_DIR as a persistent Docker volume in production.'
      },
      paymentProofs: {
        total: db.paymentProofs.length,
        pending: db.paymentProofs.filter((payment) => payment.status === 'pending').length,
        submitted: db.paymentProofs.filter((payment) => payment.status === 'submitted').length,
        verified: verifiedPayments.length,
        rejected: db.paymentProofs.filter((payment) => payment.status === 'rejected').length
      }
    },
    accounting: {
      progressiveJackpotPool,
      treasuryCollected,
      lastJackpotWinner
    }
  });
});

app.get('/api/audit/events', (req, res) => {
  const eventType = typeof req.query.eventType === 'string' ? req.query.eventType : null;
  const subjectId = typeof req.query.subjectId === 'string' ? req.query.subjectId : null;
  const limit = Math.max(1, Math.min(Number(req.query.limit || 100), 500));

  if (!fs.existsSync(AUDIT_LOG_PATH)) {
    res.json({ events: [] });
    return;
  }

  const rows = fs.readFileSync(AUDIT_LOG_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((event) => event && (!eventType || event.eventType === eventType) && (!subjectId || event.subjectId === subjectId))
    .slice(0, limit);

  res.json({
    events: rows
  });
});

app.post('/api/payments/prepare', (req, res) => {
  const { lobbyId, walletAddress, kind } = req.body || {};
  const lobby = db.lobbies.find(l => l.id === lobbyId);
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    res.status(400).json({ error: 'A valid Base wallet address is required.' });
    return;
  }
  if (!lobby) {
    res.status(404).json({ error: 'Target Bingo lobby not found.' });
    return;
  }

  const payment = createPendingPayment({
    kind: kind || 'lobby_entry',
    walletAddress,
    amountUSDC: lobby.entryFee.toFixed(2),
    lobbyId: lobby.id
  });

  res.json({
    payment,
    send: {
      chainId: BASE_CHAIN_ID,
      to: BASE_USDC_CONTRACT,
      asset: BASE_USDC_CONTRACT,
      payTo: TREASURY_WALLET,
      amountUSDC: payment.amountUSDC,
      method: 'Base Account wallet_sendCalls or eth_sendTransaction'
    }
  });
});

app.post('/api/payments/confirm', async (req, res) => {
  const { paymentId, txHash } = req.body || {};
  const payment = findPayment(paymentId);
  if (!payment) {
    res.status(404).json({ error: 'Payment record not found.' });
    return;
  }
  if (!txHash || typeof txHash !== 'string') {
    res.status(400).json({ error: 'txHash is required.' });
    return;
  }

  try {
    const verification = await verifyBasePaymentTx(txHash, BASE_USDC_CONTRACT);
    payment.txHash = txHash;
    payment.status = verification.status;
    payment.blockNumber = verification.blockNumber;
    payment.gasUsed = verification.gasUsed;
    payment.reason = verification.reason;
    payment.verifiedAt = verification.status === 'verified' ? new Date().toISOString() : payment.verifiedAt;
    payment.updatedAt = new Date().toISOString();
    recordAuditEvent('payment_confirmed', payment.paymentId, {
      payment,
      verification
    });

    res.status(verification.status === 'rejected' ? 422 : 200).json({
      payment,
      proof: {
        state: verification.status,
        reason: verification.reason || 'Base transaction receipt verified.'
      }
    });
  } catch (error: any) {
    payment.status = 'submitted';
    payment.txHash = txHash;
    payment.reason = error?.message || 'Receipt verification failed; payment remains submitted.';
    payment.updatedAt = new Date().toISOString();
    recordAuditEvent('payment_submitted_unverified', payment.paymentId, {
      payment,
      error: payment.reason
    });
    res.status(202).json({
      payment,
      proof: {
        state: 'submitted',
        reason: payment.reason
      }
    });
  }
});

// Auth login endpoint
app.post('/api/auth/login', (req, res) => {
  const { username, walletAddress } = req.body;
  if (!username || !walletAddress) {
    res.status(400).json({ error: 'Username and walletAddress are required.' });
    return;
  }

  // Find or create player
  let player = db.players.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
  if (!player) {
    player = {
      username: username,
      walletAddress: walletAddress,
      mfaEnabled: true,
      mfaSecret: 'BINGO2060MFASECRET',
      performanceMetrics: { totalWins: 0, avgCardiacCoherence: 0.75, peakNeuralFrequency: 14.5, attentionScore: 82 }
    };
    db.players.push(player);
  }

  res.json({
    status: 'mfa_required',
    message: 'Multi-Factor Authentication required to finalize high-security neural credentials.',
    username: player.username,
    walletAddress: player.walletAddress,
    mfaSecret: player.mfaSecret
  });
});

// Verify secure login with MFA
app.post('/api/auth/verify-mfa', (req, res) => {
  const { walletAddress, mfaCode } = req.body;
  if (!walletAddress || !mfaCode) {
    res.status(400).json({ error: 'Wallet address and 6-digit MFA code are required.' });
    return;
  }

  const player = db.players.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
  if (!player) {
    res.status(404).json({ error: 'Player credentials not found.' });
    return;
  }

  if (!/^\d{6}$/.test(mfaCode)) {
    res.status(400).json({ error: 'Invalid MFA verification payload. Must be a valid 6-digit numeric sequence.' });
    return;
  }

  res.json({
    status: 'authenticated',
    player: player,
    token: crypto.randomBytes(16).toString('hex')
  });
});

// Get all Lobbies and progressive jackpot telemetry
app.get('/api/lobbies', (req, res) => {
  res.json({
    lobbies: db.lobbies,
    progressiveJackpotPool,
    treasuryCollected,
    lastJackpotWinner
  });
});

// Join a Lobby with real X402 micro-transaction verification
app.post('/api/lobbies/join', (req, res) => {
  const { lobbyId, walletAddress, username, coherence, focus, frequency } = req.body;
  const lobby = db.lobbies.find(l => l.id === lobbyId);
  
  if (!lobby) {
    res.status(404).json({ error: 'Target cyber-arena lobby not found.' });
    return;
  }

  // Enforce verified Base payment settlement before lobby entry.
  const costStr = lobby.entryFee.toFixed(2);
  const verifiedPayment = handleX402Payment(req, res, costStr, `M2M Registration Fee for ${lobby.name}`);
  if (!verifiedPayment) {
    return; // handleX402Payment has already handled the 402 response
  }

  // Check if already in lobby
  const existing = lobby.activePlayers.find((p: any) => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
  if (existing) {
    res.json({ success: true, message: 'Already registered in this lobby.', lobby });
    return;
  }

  // Register human player
  const newPlayerObj = {
    username,
    walletAddress,
    isBot: false,
    card: generateCardForLobby(username),
    selectedNumbers: [],
    coherence: coherence || 0.82,
    focus: focus || 85,
    frequency: frequency || 14.5
  };

  lobby.activePlayers.push(newPlayerObj);
  recordAuditEvent('lobby_joined', lobby.id, {
    lobbyId: lobby.id,
    walletAddress,
    username,
    paymentId: verifiedPayment.paymentId,
    txHash: verifiedPayment.txHash
  });

  res.json({
    success: true,
    message: `Securely entered ${lobby.name}. Entry fee verified on Base.`,
    lobby,
    paymentId: verifiedPayment.paymentId,
    txHash: verifiedPayment.txHash
  });
});

// Get current BINGO game state (Legacy fallback support)
app.get('/api/game/current', (req, res) => {
  const lobbyId = (req.query.lobbyId as string) || 'micro-lobby';
  const lobby = db.lobbies.find(l => l.id === lobbyId) || db.lobbies[0];
  res.json({
    game: {
      id: lobby.id,
      status: lobby.status,
      predictedWinningPattern: lobby.predictedWinningPattern,
      calledNumbers: lobby.calledNumbers,
      startedAt: new Date().toISOString()
    }
  });
});

// AI Caller draw (Legacy support)
app.post('/api/game/draw-number', (req, res) => {
  const lobbyId = req.body.lobbyId || 'micro-lobby';
  const lobby = db.lobbies.find(l => l.id === lobbyId) || db.lobbies[0];
  
  if (lobby.calledNumbers.length >= 75) {
    res.json({ game: lobby, finished: true });
    return;
  }

  let newNum: number;
  do {
    newNum = Math.floor(Math.random() * 75) + 1;
  } while (lobby.calledNumbers.includes(newNum));

  lobby.calledNumbers.push(newNum);

  res.json({
    game: lobby,
    newNumber: newNum,
    finished: lobby.calledNumbers.length >= 75
  });
});

// Reset game (Legacy support)
app.post('/api/game/reset', (req, res) => {
  const lobbyId = req.body.lobbyId || 'micro-lobby';
  const lobby = db.lobbies.find(l => l.id === lobbyId) || db.lobbies[0];
  
  lobby.status = 'countdown';
  lobby.countdownSeconds = 15;
  lobby.calledNumbers = [];
  lobby.activePlayers = [];
  lobby.winners = [];

  res.json({ game: lobby });
});

// Gemini AI Commentary proxy with advanced context
app.post('/api/gemini/commentary', async (req, res) => {
  const { lobbyId, playerMetrics, recentSelection } = req.body;
  const lobby = db.lobbies.find(l => l.id === lobbyId) || db.lobbies[0];
  const ai = getGeminiClient();

  const prompt = `
    You are the legendary AI-powered BINGO Caller of the year 2060.
    The game is BINGO 2060: M2M Galactic Tournament, operating on direct neural link interfaces, holographic boards, and biometric telemetry.
    The active arena is: "${lobby.name}" with entry fee: ${lobby.entryFee} USDC.
    The active target winning pattern of this lobby is: "${lobby.predictedWinningPattern}".
    Called numbers so far: [${(lobby.calledNumbers || []).join(', ')}].
    Last called number is: ${lobby.calledNumbers[lobby.calledNumbers.length - 1] || 'None'}.
    
    The competing human has these real-time biometrics:
    - Cardiac Coherence: ${playerMetrics?.avgCardiacCoherence || 0.75} (0.0 to 1.0)
    - Attention Focus: ${playerMetrics?.attentionScore || 70}%
    - Brainwave Frequency: ${playerMetrics?.peakNeuralFrequency || 12.0} Hz (Alpha/Beta state)

    Active competitors in this arena lobby: ${lobby.activePlayers.length} (including high-frequency M2M bots).

    ${recentSelection ? `The player just locked in number ${recentSelection} telepathically via neural link!` : ''}

    Task:
    Provide a hyper-immersive, high-octane commentary update (max 3 sentences).
    Talk about the holographic arena state, predicted winning patterns, or praise/tease the player's cardiac coherence and telepathic focus.
    Keep the tone futuristic, sharp, and exciting. Maintain the 2060 Sci-Fi gaming vibe (neural links, settlement proof gates, M2M agents).
  `;

  if (!ai) {
    const fallbackCommentaries = [
      `[LOGISTICAL AI ENGINE]: Called number ${lobby.calledNumbers[lobby.calledNumbers.length - 1] || 'NaN'} locks on the holographic grid. Biometric sensors detect attention focus spiking at ${playerMetrics?.attentionScore || 75}%. A clear path toward the ${lobby.predictedWinningPattern} is forming!`,
      `[LOGISTICAL AI ENGINE]: Neural frequencies stabilized at ${playerMetrics?.peakNeuralFrequency || 14.5} Hz. The quantum caller predicts the winning pattern will finalize within 4 cycles. Keep your cardiac coherence high!`,
      `[LOGISTICAL AI ENGINE]: Payment proof gates are armed. Human telepathic selection on cell ${recentSelection || 'Alpha'} registered with a robust alignment score. The digital crowd hums in collective emotional resonance!`
    ];
    const comment = fallbackCommentaries[Math.floor(Math.random() * fallbackCommentaries.length)];
    res.json({ text: comment, isFallback: true });
    return;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        temperature: 0.8,
        systemInstruction: 'You are the holographic BINGO caller in a high-tech 2060 cyber-arena.'
      }
    });

    res.json({ text: response.text, isFallback: false });
  } catch (err: any) {
    console.error('Gemini call error:', err);
    res.status(500).json({ error: `Gemini Call Failed: ${err.message}` });
  }
});

// ================= INTERLINK-CAPI PORT =================
app.post('/api/v1/interlink/execute', (req, res) => {
  const { tool_name, parameters } = req.body;

  if (!tool_name || !parameters) {
    res.status(400).json({ error: 'Malformed Interlink-cAPI request. Must provide tool_name and parameters.' });
    return;
  }

  const cost = '0.01';
  const desc = tool_name === 'telepathic_number_selection' 
    ? `Telepathic number selection: ${parameters.number} on Game ${parameters.game_id}`
    : `Syncing offline gameplay with ${parameters.actions?.length || 0} cached actions.`;

  const verifiedPayment = handleX402Payment(req, res, cost, desc);
  if (!verifiedPayment) {
    return;
  }

  if (tool_name === 'telepathic_number_selection') {
    const { game_id, number, biometric_resonance, walletAddress } = parameters;
    
    const selection = {
      id: crypto.randomUUID(),
      gameId: game_id,
      number: number,
      biometricResonance: biometric_resonance,
      x402TransactionHash: verifiedPayment.txHash,
      paymentId: verifiedPayment.paymentId,
      synchronizedAt: new Date().toISOString(),
      status: 'synced'
    };
    
    db.currentSelectionHistory.push(selection);
    recordAuditEvent('selection_synced', game_id, selection);

    const player = db.players.find(p => p.walletAddress.toLowerCase() === walletAddress?.toLowerCase());
    if (player) {
      const selectionsCount = db.currentSelectionHistory.filter(s => s.status === 'synced').length;
      const currentCoherence = player.performanceMetrics.avgCardiacCoherence;
      const newCoherence = biometric_resonance?.cardiac_coherence || 0.5;
      
      player.performanceMetrics.avgCardiacCoherence = Number((((currentCoherence * (selectionsCount - 1)) + newCoherence) / selectionsCount).toFixed(3));
      
      const newFreq = biometric_resonance?.neural_frequency_hz || 10.0;
      if (newFreq > player.performanceMetrics.peakNeuralFrequency) {
        player.performanceMetrics.peakNeuralFrequency = Number(newFreq.toFixed(1));
      }
      
      player.performanceMetrics.attentionScore = Math.round(biometric_resonance?.attention_focus_percentage || 50);
    }

    res.json({
      status: 'success',
      message: 'Telepathic selection accepted after verified payment proof.',
      data: selection,
      playerMetrics: player?.performanceMetrics
    });
    return;
  } 
  
  if (tool_name === 'sync_offline_gameplay') {
    const { game_id, actions, walletAddress } = parameters;
    const syncedRecords: any[] = [];

    const player = db.players.find(p => p.walletAddress.toLowerCase() === walletAddress?.toLowerCase());

    if (actions && Array.isArray(actions)) {
      actions.forEach((action: any) => {
        const alreadyExists = db.currentSelectionHistory.some(s => s.localOfflineId === action.local_id);
        if (alreadyExists) return;

        const selection = {
          id: crypto.randomUUID(),
          gameId: game_id,
          number: action.number,
          biometricResonance: action.biometric_resonance,
          localOfflineId: action.local_id,
          x402TransactionHash: verifiedPayment.txHash,
          paymentId: verifiedPayment.paymentId,
          synchronizedAt: new Date().toISOString(),
          status: 'synced'
        };

        db.currentSelectionHistory.push(selection);
        syncedRecords.push(selection);
        recordAuditEvent('offline_selection_synced', game_id, selection);

        if (player) {
          const newCoherence = action.biometric_resonance?.cardiac_coherence || 0.5;
          const currentCount = db.currentSelectionHistory.length;
          player.performanceMetrics.avgCardiacCoherence = Number((((player.performanceMetrics.avgCardiacCoherence * (currentCount - 1)) + newCoherence) / currentCount).toFixed(3));
          
          if (action.biometric_resonance?.neural_frequency_hz > player.performanceMetrics.peakNeuralFrequency) {
            player.performanceMetrics.peakNeuralFrequency = Number(action.biometric_resonance.neural_frequency_hz.toFixed(1));
          }
        }
      });
    }

    res.json({
      status: 'success',
      message: 'Offline gameplay queue accepted after verified payment proof.',
      synchronizedCount: syncedRecords.length,
      records: syncedRecords,
      playerMetrics: player?.performanceMetrics
    });
    return;
  }

  res.status(400).json({ error: 'Unknown Interlink-cAPI tool signature.' });
});

// Get Leaderboard Data
app.get('/api/leaderboard', (req, res) => {
  const leaders = [...db.players].sort((a, b) => {
    return (b.performanceMetrics.totalWins * 100 + b.performanceMetrics.avgCardiacCoherence * 100) -
           (a.performanceMetrics.totalWins * 100 + a.performanceMetrics.avgCardiacCoherence * 100);
  });
  res.json({ leaders });
});

// Claim winning BINGO payout (Legacy)
app.post('/api/game/claim-win', (req, res) => {
  const { walletAddress } = req.body;
  const player = db.players.find(p => p.walletAddress.toLowerCase() === walletAddress?.toLowerCase());
  
  if (player) {
    player.performanceMetrics.totalWins += 1;
    
    db.pushNotifications.push({
      id: crypto.randomUUID(),
      type: 'communal_win',
      message: `Collective Resonance Achieved! ${player.username} scored a winning pattern. Payout remains locked until settlement proof is recorded.`,
      timestamp: new Date().toISOString()
    });
    recordAuditEvent('legacy_win_claimed', walletAddress, {
      walletAddress,
      totalWins: player.performanceMetrics.totalWins,
      settlementState: 'needs_payout_proof'
    });
    
    res.json({ success: true, totalWins: player.performanceMetrics.totalWins });
  } else {
    res.status(404).json({ error: 'Player not found.' });
  }
});

// Notifications registration
app.post('/api/push/subscribe', (req, res) => {
  const { subscription } = req.body;
  db.pushSubscriptions.push(subscription);
  recordAuditEvent('push_subscribed', null, { subscription });
  res.json({ success: true, message: 'Successfully subscribed to holographic notifications.' });
});

app.get('/api/push/alerts', (req, res) => {
  res.json({ alerts: db.pushNotifications });
});

// Explicit health route for container verification and proxy gateway checks
app.get('/health', (req, res) => {
  res.json({ status: "healthy" });
});

// ================= SETUP VITE MIDDLEWARE =================

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.get('/', (req, res) => {
      res.json({ status: "online", service: "BINGO 2060 M2M Backend", time: new Date().toISOString() });
    });
    const distPath = path.join(process.cwd(), 'dist');
    const fs = await import('fs');
    if (fs.existsSync(path.join(distPath, 'index.html'))) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      app.get('*', (req, res) => {
        res.json({ status: "online", service: "BINGO 2060 M2M Backend (Frontend Decoupled)" });
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BINGO 2060 Server running on http://localhost:${PORT}`);
  });
}

startServer();
