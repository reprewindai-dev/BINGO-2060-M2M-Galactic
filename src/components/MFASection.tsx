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
          {/* Prominent primary Base Smart Wallet connector */}
          <button
            onClick={() => {
              const smartConnector = connectors.find(c => c.id === 'coinbaseWallet' || c.id === 'baseAccount');
              if (smartConnector) {
                connect({ connector: smartConnector });
              } else if (connectors.length > 0) {
                connect({ connector: connectors[0] });
              }
            }}
            disabled={isPending}
            className="w-full flex items-center justify-center gap-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-4 px-6 rounded-xl transition-all cursor-pointer shadow-lg hover:shadow-blue-500/20 active:scale-[0.99] border border-blue-500/30"
          >
            <Wallet className="w-5 h-5 shrink-0" />
            <div className="text-left">
              <div className="text-sm font-bold uppercase tracking-wider">Connect Base Smart Wallet</div>
              <div className="text-[10px] text-blue-200 font-normal normal-case">Fast, free, and secure (no extensions needed)</div>
            </div>
          </button>

          {/* Collapsible section for other wallets */}
          <div className="pt-2 text-center">
            <details className="group">
              <summary className="text-[11px] text-white/40 hover:text-white/60 cursor-pointer font-mono select-none list-none uppercase tracking-widest">
                — Or select other wallets —
              </summary>
              <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
                {connectors
                  .filter(c => c.id !== 'coinbaseWallet' && c.id !== 'baseAccount')
                  .map((connector) => (
                    <button
                      key={connector.uid}
                      onClick={() => connect({ connector })}
                      disabled={isPending}
                      className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 text-white border border-white/10 py-2.5 px-4 rounded-lg transition-all cursor-pointer text-xs font-mono"
                    >
                      <span>Connect {connector.name}</span>
                      <Wallet className="w-3.5 h-3.5 opacity-50" />
                    </button>
                  ))}
              </div>
            </details>
          </div>
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
