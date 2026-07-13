import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClientProvider } from '@tanstack/react-query';
import { bingoWalletConfig, bingoQueryClient } from './walletConfig';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={bingoWalletConfig}>
      <QueryClientProvider client={bingoQueryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
