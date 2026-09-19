const WALLET_SESSION_KEY = "gp_wallet_last_connected_at_ms";
export const WALLET_SESSION_CHANGE_EVENT = "gp:wallet-session-change";
export const WALLET_SESSION_TTL_MS = 5 * 60 * 1000;

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function emitWalletSessionChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WALLET_SESSION_CHANGE_EVENT));
}

export function readWalletLastConnectedAtMs(): number | null {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.getItem(WALLET_SESSION_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function markWalletConnectedNow(): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(WALLET_SESSION_KEY, String(Date.now()));
  emitWalletSessionChange();
}

export function clearWalletSessionTimestamp(): void {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(WALLET_SESSION_KEY);
  emitWalletSessionChange();
}

export function isWalletSessionExpired(nowMs: number = Date.now()): boolean {
  const lastConnectedAt = readWalletLastConnectedAtMs();
  if (lastConnectedAt === null) return true;
  return nowMs - lastConnectedAt > WALLET_SESSION_TTL_MS;
}
