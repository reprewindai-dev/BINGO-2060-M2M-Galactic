import React, { useState, useEffect } from 'react';
import { ShieldCheck, Cpu, Key, Activity, Gamepad2 } from 'lucide-react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Player } from '../types';

interface MFASectionProps {
  onAuthenticated: (player: Player) => void;
}

export default function MFASection({ onAuthenticated }: MFASectionProps) {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lobbySelected, setLobbySelected] = useState<string | null>(null);

  // Automatically attempt login when wallet is connected and username is provided
  const handleNeuralLink = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isConnected || !address) {
      setError('Wallet must be connected first.');
      return;
    }
    if (!username.trim()) {
      setError('Please provide a Neural Handle.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, walletAddress: address }),
      });
      const data = await response.json();

      if (response.ok && data.status === 'authenticated') {
        onAuthenticated(data.player);
      } else {
        setError(data.error || 'Authentication handshake failed.');
      }
    } catch (err) {
      setError('Connection to security gateway timed out.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="mfa-section-container" className="max-w-md w-full mx-auto bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 left-0 w-32 h-32 bg-[#00f3ff]/10 rounded-full blur-3xl -z-10"></div>
      <div className="absolute bottom-0 right-0 w-32 h-32 bg-[#bc13fe]/10 rounded-full blur-3xl -z-10"></div>

      <div className="text-center mb-8">
        <div className="inline-flex p-3 bg-black/40 border border-[#00f3ff]/30 rounded-2xl mb-4 shadow-inner">
          <ShieldCheck className="w-8 h-8 text-[#00f3ff] animate-pulse" />
        </div>
        <h2 className="text-xl font-black tracking-tighter uppercase leading-none italic text-[#00f3ff]">
          BINGO 2060 SECURITY PORTAL
        </h2>
        <p className="text-[10px] tracking-[0.2em] uppercase text-white/50 mt-2 font-mono">
          Establish cryptographic link to the Base Mainnet X402 rail
        </p>
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-950/40 border border-red-500/30 rounded-lg text-xs text-red-300 font-mono flex items-start gap-2">
          <span className="font-bold">ALERT:</span> {error}
        </div>
      )}

      {!isConnected ? (
        <div className="space-y-4">
          <label className="block text-[10px] font-bold text-[#00f3ff] uppercase tracking-widest text-center font-mono mb-4">
            Connect Secure Identity Provider
          </label>
          
          {connectors.map((connector) => (
            <button
              key={connector.uid}
              onClick={() => connect({ connector })}
              disabled={isPending}
              className="w-full flex items-center justify-center gap-2 bg-black/40 border border-white/10 hover:border-[#00f3ff] text-white font-mono text-xs uppercase tracking-widest py-3 px-4 rounded-xl transition-all cursor-pointer shadow-inner"
            >
              <Key className="w-4 h-4 text-[#00f3ff]" />
              {isPending ? 'Connecting...' : `Connect with ${connector.name}`}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="p-3 bg-[#00f3ff]/5 border border-[#00f3ff]/30 rounded-xl text-center">
            <p className="text-[10px] text-[#00f3ff] font-mono uppercase tracking-widest">Secure Wallet Connected</p>
            <p className="text-xs text-white font-mono mt-1 break-all">{address}</p>
            <button 
              onClick={() => disconnect()}
              className="mt-2 text-[10px] text-white/50 hover:text-white underline font-mono"
            >
              Disconnect
            </button>
          </div>

          <form onSubmit={handleNeuralLink} className="space-y-5">
            <div>
              <label className="block text-[10px] font-bold text-[#bc13fe] uppercase tracking-widest mb-2 font-mono">
                Initialize Neural Handle
              </label>
              <div className="relative">
                <Cpu className="absolute left-3 top-3.5 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  placeholder="e.g. CyberAthlete_01"
                  className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:border-[#bc13fe] focus:outline-none transition-colors font-mono text-white placeholder-white/30"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-[#00f3ff] to-[#bc13fe] text-black font-black uppercase tracking-widest py-3 px-4 rounded-xl transition-all cursor-pointer font-mono text-xs shadow-[0_0_20px_rgba(0,243,255,0.4)] hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'CALIBRATING HANDSHAKE...' : 'ESTABLISH NEURAL LINK'}
            </button>
          </form>
        </div>
      )}

      <div className="mt-8 border-t border-white/10 pt-4 text-center">
        <p className="text-[10px] text-white/40 font-mono leading-relaxed">
          Authorized on-chain asset mapping under Base App ID 6a20f24cc341f72c2f573eb5.
        </p>
      </div>
    </div>
  );
}
