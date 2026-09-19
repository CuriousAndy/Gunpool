export const DEMO_WALLET_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
export const DEMO_WALLET_STATE_CHANGE_EVENT = "gp-demo-wallet-state-change";

const DEMO_WALLET_STATE_KEY = "gp_demo_wallet_state_v1";

export type DemoWalletState = {
  walletBalance: number;
  vaultBalance: number;
};

export const DEFAULT_DEMO_WALLET_STATE: DemoWalletState = {
  walletBalance: 150,
  vaultBalance: 450,
};

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function roundAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(4));
}

function normalizeState(input: Partial<DemoWalletState> | null | undefined): DemoWalletState {
  return {
    walletBalance: roundAmount(Math.max(0, Number(input?.walletBalance ?? DEFAULT_DEMO_WALLET_STATE.walletBalance))),
    vaultBalance: roundAmount(Math.max(0, Number(input?.vaultBalance ?? DEFAULT_DEMO_WALLET_STATE.vaultBalance))),
  };
}

export function readDemoWalletState(): DemoWalletState {
  const storage = getStorage();
  if (!storage) return DEFAULT_DEMO_WALLET_STATE;

  const raw = storage.getItem(DEMO_WALLET_STATE_KEY);
  if (!raw) return DEFAULT_DEMO_WALLET_STATE;

  try {
    const parsed = JSON.parse(raw) as Partial<DemoWalletState>;
    return normalizeState(parsed);
  } catch {
    return DEFAULT_DEMO_WALLET_STATE;
  }
}

export function writeDemoWalletState(next: DemoWalletState): DemoWalletState {
  const normalized = normalizeState(next);
  const storage = getStorage();
  if (storage) {
    storage.setItem(DEMO_WALLET_STATE_KEY, JSON.stringify(normalized));
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(DEMO_WALLET_STATE_CHANGE_EVENT));
  }
  return normalized;
}

export function ensureDemoWalletState(): DemoWalletState {
  const storage = getStorage();
  if (!storage) return DEFAULT_DEMO_WALLET_STATE;

  const current = readDemoWalletState();
  storage.setItem(DEMO_WALLET_STATE_KEY, JSON.stringify(current));
  return current;
}

export function applyDemoWalletDeposit(amount: number): DemoWalletState | null {
  const current = readDemoWalletState();
  if (!Number.isFinite(amount) || amount <= 0 || current.walletBalance < amount) {
    return null;
  }

  return writeDemoWalletState({
    walletBalance: current.walletBalance - amount,
    vaultBalance: current.vaultBalance + amount,
  });
}

export function applyDemoWalletWithdraw(amount: number): DemoWalletState | null {
  const current = readDemoWalletState();
  if (!Number.isFinite(amount) || amount <= 0 || current.vaultBalance < amount) {
    return null;
  }

  return writeDemoWalletState({
    walletBalance: current.walletBalance + amount,
    vaultBalance: current.vaultBalance - amount,
  });
}
