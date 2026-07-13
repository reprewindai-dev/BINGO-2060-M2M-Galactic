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
  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isConnected || !address) {
      setError('Wallet must be connected first.');
      return;
    }
    if (!username.trim()) {
      setError('Please provide a Username.');
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
        setError(data.error || 'Authentication failed.');
      }
    } catch (err) {
      setError('Connection timed out.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="mfa-section-container" className="max-w-md w-full mx-auto bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 left-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -z-10"></div>
      <div className="absolute bottom-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl -z-10"></div>

      <div className="text-center mb-8">
        <div className="inline-flex p-3 bg-black/40 border border-blue-500/30 rounded-2xl mb-4 shadow-inner">
          <Gamepad2 className="w-8 h-8 text-blue-400" />
        </div>
        <h2 className="text-xl font-bold uppercase leading-none text-white">
          Join Bingo 2060
        </h2>
        <p className="text-xs text-white/50 mt-2 font-mono">
          Connect your wallet to participate on Base Mainnet
        </p>
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-950/40 border border-red-500/30 rounded-lg text-xs text-red-300 font-mono flex items-start gap-2">
          <span className="font-bold">ALERT:</span> {error}
        </div>
      )}

      {!isConnected ? (
        <div className="space-y-4">
          <label className="block text-xs font-bold text-white uppercase tracking-wider text-center mb-4">
            Connect Your Wallet
          </label>
          
          {connectors.map((connector) => (
            <button
              key={connector.uid}
              onClick={() => connect({ connector })}
              disabled={isPending}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-xl transition-all cursor-pointer shadow"
            >
              <Wallet className="w-4 h-4" />
              {isPending ? 'Connecting...' : `Connect ${connector.name}`}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl text-center">
            <p className="text-xs text-blue-400 font-bold uppercase tracking-wider">Wallet Connected</p>
            <p className="text-xs text-white font-mono mt-1 break-all">{address}</p>
            <button 
              onClick={() => disconnect()}
              className="mt-2 text-xs text-white/50 hover:text-white underline"
            >
              Disconnect
            </button>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-white uppercase tracking-wider mb-2">
                Choose a Username
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="e.g. Player_01"
                  className="w-full bg-black/40 border border-white/20 rounded-xl py-3 px-4 text-sm focus:border-blue-500 focus:outline-none transition-colors text-white placeholder-white/40"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold uppercase tracking-wider py-3 px-4 rounded-xl transition-all cursor-pointer shadow-lg disabled:opacity-50"
            >
              {loading ? 'Joining Game...' : 'Play Now'}
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
