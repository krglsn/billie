/** Circle USDC on Ethereum Sepolia — keep in sync with reference.md */
export const TOKENS = {
  USDC: {
    symbol: "USDC",
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const,
    decimals: 6,
    chainId: 11155111,
  },
} as const;

export type TokenSymbol = keyof typeof TOKENS;
