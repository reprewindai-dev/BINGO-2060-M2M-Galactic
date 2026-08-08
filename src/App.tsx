import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, RefreshCw, ShieldCheck, Trophy, Wallet, Zap } from 'lucide-react';

const USDC_TRANSFER_SELECTOR = 'a9059cbb';

type Player = {
  id: string;
  username: string;
  walletAddress: string;
  points: number;
  wins: number;
  rounds: number;
};

type Lobby = {
  id: string;
  name: string;
  description: string;
  accessPriceUsdc: number;
  paidAccessRequired: boolean;
  status: 'countdown' | 'active' | 'complete';
  countdownSeconds: number;
  calledNumbers: number[];
  activePlayers: Array<{ username: string; walletAddress: string; selectedNumbers: number[] }>;
  winners: string[];
  roundId: string;
  pattern: string;
};

type PreparedPayment = {
  payment: {
    id: string;
    walletAddress: string;
    lobbyId: string;
    amountUsdc: number;
    status: string;
    txHash?: string;
    reason?: string;
  };
  send: {
    chainId: number;
    tokenContract: string;
    payTo: string;
    amountUsdc: number;
    decimals: number;
  };
};

function short(value?: string | null, size = 7) {
  if (!value) return '—';
  return value.length > size * 2 + 3 ? `${value.slice(0, size)}…${value.slice(-size)}` : value;
}

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || body?.detail || `HTTP ${response.status}`);
  return body;
}

function encodeUsdcTransfer(payTo: string, amountUsdc: number) {
  const address = payTo.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const amount = BigInt(Math.round(amountUsdc * 1_000_000)).toString(16).padStart(64, '0');
  return `0x${USDC_TRANSFER_SELECTOR}${address}${amount}`;
}

export default function App() {
  const [wallet, setWallet] = useState<string>('');
  const [username, setUsername] = useState('');
  const [player, setPlayer] = useState<Player | null>(null);
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [leaders, setLeaders] = useState<Player[]>([]);
  const [service, setService] = useState<any>(null);
  const [selectedLobby, setSelectedLobby] = useState<string>('signal-line');
  const [message, setMessage] = useState('Connect a Base wallet to begin.');
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<PreparedPayment | null>(null);
  const [paymentId, setPaymentId] = useState<string>('');
  const [txHash, setTxHash] = useState<string>('');

  const activeLobby = useMemo(
    () => lobbies.find(lobby => lobby.id === selectedLobby) || lobbies[0],
    [lobbies, selectedLobby]
  );

  const refresh = useCallback(async () => {
    try {
      const [state, leaderboard] = await Promise.all([
        api('/api/state'),
        api('/api/leaderboard'),
      ]);
      setService(state);
      setLobbies(state.lobbies || []);
      setLeaders(leaderboard.leaders || []);
    } catch (error: any) {
      setMessage(error.message || 'Unable to load Bingo state.');
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const connectWallet = async () => {
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      setMessage('No injected wallet found. Open Bingo 2060 in Coinbase Wallet, MetaMask, Rabby, or another Base-compatible wallet browser.');
      return;
    }
    setBusy(true);
    try {
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts?.[0]) throw new Error('No wallet account authorized.');
      try {
        await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
      } catch (switchError: any) {
        if (switchError?.code === 4902) {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0x2105',
              chainName: 'Base Mainnet',
              rpcUrls: ['https://mainnet.base.org'],
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              blockExplorerUrls: ['https://basescan.org'],
            }],
          });
        } else {
          throw switchError;
        }
      }
      setWallet(accounts[0]);
      setMessage('Wallet connected. Create or load your player identity.');
    } catch (error: any) {
      setMessage(error.message || 'Wallet connection failed.');
    } finally {
      setBusy(false);
    }
  };

  const createPlayer = async () => {
    if (!wallet || username.trim().length < 2) {
      setMessage('Connect a wallet and choose a display name first.');
      return;
    }
    setBusy(true);
    try {
      const body = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), walletAddress: wallet }),
      });
      setPlayer(body.player);
      setMessage(`Player loaded: ${body.player.username}.`);
      await refresh();
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const prepareAccess = async () => {
    if (!player || !activeLobby) return;
    setBusy(true);
    try {
      const body = await api('/api/payments/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lobbyId: activeLobby.id, walletAddress: player.walletAddress }),
      });
      setPrepared(body);
      setPaymentId(body.payment.id);
      setTxHash('');
      setMessage(`Payment prepared for ${body.payment.amountUsdc.toFixed(2)} USDC on Base.`);
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const sendPayment = async () => {
    if (!prepared) return;
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      setMessage('A browser wallet is required to send the Base USDC payment.');
      return;
    }
    setBusy(true);
    try {
      const data = encodeUsdcTransfer(prepared.send.payTo, prepared.send.amountUsdc);
      const hash = await ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: prepared.payment.walletAddress,
          to: prepared.send.tokenContract,
          data,
          value: '0x0',
        }],
      });
      setTxHash(hash);
      setMessage(`Transaction submitted: ${short(hash, 10)}. Confirm it once Base has a receipt.`);
    } catch (error: any) {
      setMessage(error.message || 'Payment transaction was not submitted.');
    } finally {
      setBusy(false);
    }
  };

  const confirmPayment = async () => {
    if (!paymentId || !txHash) return;
    setBusy(true);
    try {
      const body = await api('/api/payments/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, txHash }),
      });
      setPrepared(prev => prev ? { ...prev, payment: body.payment } : prev);
      if (body.payment.status === 'verified') {
        setMessage('Base USDC transfer verified. The payment can now be consumed for lobby access.');
      } else {
        setMessage(body.payment.reason || `Payment state: ${body.payment.status}`);
      }
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const joinLobby = async () => {
    if (!player || !activeLobby) return;
    setBusy(true);
    try {
      const body = await api('/api/lobbies/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lobbyId: activeLobby.id,
          walletAddress: player.walletAddress,
          username: player.username,
          paymentId: service?.paidAccessEnabled ? paymentId : undefined,
        }),
      });
      setMessage(`Joined ${body.lobby.name}. Your card and round state are now server-backed.`);
      setPrepared(null);
      setPaymentId('');
      setTxHash('');
      await refresh();
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const isJoined = Boolean(player && activeLobby?.activePlayers?.some(
    item => item.walletAddress.toLowerCase() === player.walletAddress.toLowerCase()
  ));

  return (
    <main className="min-h-screen bg-[#05070c] text-slate-100">
      <header className="border-b border-cyan-500/15 bg-[#080b12] px-5 py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-400">Bingo 2060 · M2M Galactic</div>
            <h1 className="mt-1 text-2xl font-semibold">Verified access. Persistent rounds. No fake balances.</h1>
          </div>
          <button onClick={wallet ? () => {} : connectWallet} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm">
            <Wallet className="mr-2 inline" size={16} />{wallet ? short(wallet) : 'Connect Base wallet'}
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[1fr_340px]">
        <section className="space-y-5">
          <div className="rounded-2xl border border-white/10 bg-[#0b1019] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Player identity</h2>
                <p className="mt-1 text-sm text-slate-400">One wallet, one persistent game history. Points and wins come from completed server rounds.</p>
              </div>
              {player && <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300"><CheckCircle2 className="mr-1 inline" size={14} />active</span>}
            </div>
            {!player ? (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Display name" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2" />
                <button disabled={busy || !wallet} onClick={createPlayer} className="rounded-lg bg-cyan-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-40">Create / load player</button>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Metric label="Points" value={player.points.toLocaleString()} />
                <Metric label="Wins" value={String(player.wins)} />
                <Metric label="Rounds" value={String(player.rounds)} />
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {lobbies.map(lobby => (
              <button key={lobby.id} onClick={() => setSelectedLobby(lobby.id)} className={`rounded-xl border p-4 text-left ${selectedLobby === lobby.id ? 'border-cyan-400/50 bg-cyan-400/10' : 'border-white/10 bg-[#0b1019]'}`}>
                <div className="text-sm font-semibold">{lobby.name}</div>
                <div className="mt-1 text-xs text-slate-500">{lobby.description}</div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-slate-400">{lobby.pattern}</span>
                  <span className="text-cyan-300">{lobby.status}</span>
                </div>
              </button>
            ))}
          </div>

          {activeLobby && (
            <div className="rounded-2xl border border-white/10 bg-[#0b1019] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{activeLobby.name}</h2>
                  <p className="mt-1 text-sm text-slate-400">Round {short(activeLobby.roundId, 10)} · {activeLobby.activePlayers.length} player(s)</p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-cyan-300">{activeLobby.calledNumbers.length}<span className="text-sm text-slate-500"> / 75</span></div>
                  <div className="text-xs text-slate-500">numbers called</div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-10 gap-1">
                {Array.from({ length: 75 }, (_, i) => i + 1).map(number => (
                  <div key={number} className={`grid aspect-square place-items-center rounded text-[10px] font-mono ${activeLobby.calledNumbers.includes(number) ? 'bg-cyan-400 text-slate-950' : 'bg-white/[0.035] text-slate-600'}`}>{number}</div>
                ))}
              </div>

              <div className="mt-5 rounded-lg border border-white/5 bg-black/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Access</div>
                    <div className="text-xs text-slate-500">{service?.paidAccessEnabled ? `${activeLobby.accessPriceUsdc.toFixed(2)} USDC verified Base access` : 'Practice access is currently free'}</div>
                  </div>
                  {isJoined ? (
                    <span className="rounded-lg bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300"><ShieldCheck className="mr-1 inline" size={15} />Joined</span>
                  ) : service?.paidAccessEnabled ? (
                    <button disabled={busy || !player} onClick={prepared?.payment?.status === 'verified' ? joinLobby : prepareAccess} className="rounded-lg bg-cyan-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-40">{prepared?.payment?.status === 'verified' ? 'Consume verified access & join' : 'Prepare verified access'}</button>
                  ) : (
                    <button disabled={busy || !player} onClick={joinLobby} className="rounded-lg bg-cyan-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-40">Join practice round</button>
                  )}
                </div>

                {prepared && service?.paidAccessEnabled && (
                  <div className="mt-4 space-y-3 border-t border-white/5 pt-4 text-sm">
                    <div className="flex items-center justify-between"><span className="text-slate-500">Payment ID</span><button onClick={() => navigator.clipboard?.writeText(prepared.payment.id)} className="font-mono text-xs">{short(prepared.payment.id, 10)} <Copy className="inline" size={12} /></button></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">State</span><span>{prepared.payment.status}</span></div>
                    <div className="grid grid-cols-2 gap-2">
                      <button disabled={busy || Boolean(txHash)} onClick={sendPayment} className="rounded-lg border border-white/10 px-3 py-2">Send real USDC</button>
                      <button disabled={busy || !txHash} onClick={confirmPayment} className="rounded-lg border border-white/10 px-3 py-2">Verify on Base</button>
                    </div>
                    {txHash && <div className="break-all font-mono text-[10px] text-slate-500">{txHash}</div>}
                    {prepared.payment.reason && <div className="text-xs text-amber-300">{prepared.payment.reason}</div>}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-white/10 bg-[#0b1019] p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Runtime truth</h2>
              <button onClick={refresh}><RefreshCw size={15} /></button>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <Truth label="Paid access" value={service?.paidAccessEnabled ? 'enabled' : 'disabled'} />
              <Truth label="Verified payments" value={String(service?.verifiedPayments ?? 0)} />
              <Truth label="Completed rounds" value={String(service?.roundsCompleted ?? 0)} />
              <Truth label="Outcome value" value="points + history" />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#0b1019] p-5">
            <h2 className="flex items-center gap-2 font-semibold"><Trophy size={17} />Leaderboard</h2>
            <div className="mt-3 divide-y divide-white/5">
              {leaders.length === 0 ? <p className="py-3 text-sm text-slate-500">No completed player history yet.</p> : leaders.slice(0, 10).map((leader: any, index) => (
                <div key={leader.walletAddress} className="grid grid-cols-[30px_1fr_70px] gap-2 py-3 text-sm">
                  <span className="text-slate-600">#{index + 1}</span>
                  <div><div>{leader.username}</div><div className="font-mono text-[10px] text-slate-600">{short(leader.walletAddress)}</div></div>
                  <div className="text-right"><div className="text-cyan-300">{leader.points}</div><div className="text-[10px] text-slate-600">points</div></div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#0b1019] p-5">
            <h2 className="flex items-center gap-2 font-semibold"><Zap size={17} />Why it has value</h2>
            <ul className="mt-3 space-y-2 text-sm leading-5 text-slate-400">
              <li>• Persistent player history instead of seeded winnings.</li>
              <li>• Server-generated rounds and auditable state.</li>
              <li>• Optional verified M2M/x402 access on Base.</li>
              <li>• Points, patterns, wins and leaderboards create progression without fake money.</li>
            </ul>
          </div>
        </aside>
      </div>

      <div className="fixed bottom-4 left-1/2 z-30 w-[min(92vw,700px)] -translate-x-1/2 rounded-xl border border-white/10 bg-[#0b1019]/95 px-4 py-3 text-sm shadow-2xl backdrop-blur">
        {message}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/5 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>;
}

function Truth({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-200">{value}</span></div>;
}
