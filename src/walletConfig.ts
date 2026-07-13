import { QueryClient } from "@tanstack/react-query";
import { createConfig, http } from "wagmi";
import { base, mainnet } from "wagmi/chains";
import { baseAccount, coinbaseWallet, injected } from "wagmi/connectors";

export const bingoQueryClient = new QueryClient();

const walletConnectors =
  typeof window === "undefined"
    ? []
    : [
        baseAccount({
          appName: "Bingo 2060 M2M Galactic",
        }),
        coinbaseWallet({
          appName: "Bingo 2060 M2M Galactic",
        }),
        injected({
          target: "metaMask",
        }),
        injected(),
      ];

export const bingoWalletConfig = createConfig({
  chains: [base, mainnet],
  connectors: walletConnectors,
  transports: {
    [base.id]: http("https://mainnet.base.org"),
    [mainnet.id]: http(),
  },
});
