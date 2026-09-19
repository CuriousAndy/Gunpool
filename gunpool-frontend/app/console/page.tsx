"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  parseUnits,
  type Hash,
} from "viem";
import {
  useChainId,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";

import { ConsoleLayout } from "@/src/components/layout/console-layout";
import { ActionPanel, toast } from "@/src/components/ui/action-panel";
import { WalletEntryScreen } from "@/src/components/ui/wallet-entry-screen";
import { WalletMenu } from "@/src/components/ui/wallet-menu";
import {
  erc20Abi,
  type HexAddr,
  isZeroAddress,
  shortAddress,
  vaultAbi,
} from "@/src/lib/contracts";
import {
  applyDemoWalletDeposit,
  applyDemoWalletWithdraw,
  DEFAULT_DEMO_WALLET_STATE,
  DEMO_WALLET_ADDRESS,
  ensureDemoWalletState,
  type DemoWalletState,
} from "@/src/lib/demo-wallet";
import { MUSDC_ADDR, VAULT_ADDR } from "@/src/lib/deployments";
import type { MarketApyApiPayload } from "@/src/lib/market-api-types";
import { bpsToPct, readVaultSnapshot, type VaultSnapshot } from "@/src/lib/onchain";
import {
  clearWalletSessionTimestamp,
  WALLET_SESSION_CHANGE_EVENT,
  isWalletSessionExpired,
} from "@/src/lib/wallet-session";

type EChartsProps = Record<string, unknown>;

const ReactECharts = dynamic(
  async () => {
    const mod = (await import("echarts-for-react")) as {
      default: ComponentType<EChartsProps> | { default?: ComponentType<EChartsProps> };
    };
    return typeof mod.default === "function" ? mod.default : mod.default.default!;
  },
  { ssr: false }
);

const REFRESH_MS = 3000;
const MARKET_REFRESH_MS = 60_000;
const EXPECTED_CHAIN_ID = 31337;
const TX_WAIT_TIMEOUT_MS = 180000;
const TX_WAIT_POLL_MS = 1000;
const TIMELINE_INITIAL_START_MS = new Date("2026-02-22T20:00:00+08:00").getTime();
const DEPLOYMENT_MISSING_MESSAGE = "当前网络未部署 mUSDC/Vault 合约。请先执行 npm run deploy:local。";

type WalletTxReceipt = {
  blockNumber?: string | null;
  status?: string | null;
};

type WalletProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type UserState = {
  wallet: bigint;
  shares: bigint;
};

type TxWaitResult = {
  confirmed: boolean;
  seenOnPublicRpc: boolean | null;
};

type NoticeTone = "info" | "success" | "error";

type NoticeState = {
  text: string;
  tone: NoticeTone;
};

type ChartPoint = [number, number];

type DecisionPoint = {
  t: number;
  deltaPct: number;
  rebalance: number;
  reason: string;
};

function formatDemoAmount(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function pad2(v: number): string {
  return String(v).padStart(2, "0");
}

function fmtDateTime(ms: number): string {
  if (!ms) return "--";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function fmtAxis(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}\n${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}`;
}

function fmtPct(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(2)}%`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function reasonLabel(reason: string): string {
  if (reason === "already_best") return "当前池已最优";
  if (reason === "gain_below_fee") return "增益不足覆盖手续费";
  if (reason === "rebalance_executed") return "执行调仓";
  return reason;
}

function statusToneClass(tone: "neutral" | "ok" | "warn" | "error" = "neutral"): string {
  if (tone === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-700";
  if (tone === "error") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

const STATUS_TEXT = {
  title: "\u7cfb\u7edf\u72b6\u6001",
  running: "\u8fd0\u884c\u4e2d",
  disconnected: "\u672a\u8fde\u63a5",
  ok: "\u6b63\u5e38",
  warn: "\u8b66\u544a",
  error: "\u5f02\u5e38",
  expand: "\u5c55\u5f00",
  collapse: "\u6536\u8d77",
} as const;

function buildDecisionSeries(payload: MarketApyApiPayload | null): DecisionPoint[] {
  if (!payload || payload.decisions.length === 0) return [];
  return [...payload.decisions]
    .sort((a, b) => a.t - b.t)
    .map((item) => ({
      t: item.t,
      deltaPct: Number((item.deltaBps / 100).toFixed(3)),
      rebalance: item.shouldRebalance ? 1 : 0,
      reason: item.reason,
    }));
}

export default function ConsolePage() {
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const isConnecting = false;
  const { writeContractAsync } = useWriteContract();

  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [actionEditorOpen, setActionEditorOpen] = useState(false);
  const [depositInput, setDepositInput] = useState("");
  const [withdrawInput, setWithdrawInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState("");
  const [deploymentError, setDeploymentError] = useState("");
  const [marketPayload, setMarketPayload] = useState<MarketApyApiPayload | null>(null);
  const [marketError, setMarketError] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [demoWalletState, setDemoWalletState] = useState<DemoWalletState>(DEFAULT_DEMO_WALLET_STATE);

  const MUSDC = MUSDC_ADDR as HexAddr;
  const VAULT = VAULT_ADDR as HexAddr;
  const contractsReady = !isZeroAddress(MUSDC) && !isZeroAddress(VAULT);
  const isConnected = sessionReady && !sessionExpired;
  const address = DEMO_WALLET_ADDRESS as HexAddr;
  const wrongChain = false;

  const { data: decimalsData } = useReadContract({
    address: MUSDC,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: contractsReady, refetchInterval: REFRESH_MS },
  });
  const decimals = Number(decimalsData ?? 6);

  const { data: walletBalData, refetch: refetchWalletBal } = useReadContract({
    address: MUSDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(isConnected && address && contractsReady),
      refetchInterval: REFRESH_MS,
    },
  });

  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    address: MUSDC,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, VAULT] : undefined,
    query: {
      enabled: Boolean(isConnected && address && contractsReady),
      refetchInterval: REFRESH_MS,
    },
  });

  const { data: sharesData, refetch: refetchShares } = useReadContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "sharesOf",
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(isConnected && address && contractsReady),
      refetchInterval: REFRESH_MS,
    },
  });

  const { data: totalSharesData, refetch: refetchTotalShares } = useReadContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "totalShares",
    query: { enabled: contractsReady, refetchInterval: REFRESH_MS },
  });

  const { data: vaultTotalAssetsData, refetch: refetchVaultTotalAssets } = useReadContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "totalAssets",
    query: { enabled: contractsReady, refetchInterval: REFRESH_MS },
  });

  const walletBalRaw = useMemo(
    () => parseUnits(demoWalletState.walletBalance.toFixed(decimals), decimals),
    [demoWalletState.walletBalance, decimals]
  );
  const allowanceRaw = allowanceData ?? 0n;
  const userSharesRaw = sharesData ?? 0n;
  const totalSharesRaw = totalSharesData ?? 0n;
  const vaultTotalAssetsRaw = vaultTotalAssetsData ?? 0n;
  const userAssetsInVaultRaw = useMemo(
    () => parseUnits(demoWalletState.vaultBalance.toFixed(decimals), decimals),
    [demoWalletState.vaultBalance, decimals]
  );

  const walletBalText = useMemo(() => formatDemoAmount(demoWalletState.walletBalance), [demoWalletState.walletBalance]);
  const vaultBalText = useMemo(() => formatDemoAmount(demoWalletState.vaultBalance), [demoWalletState.vaultBalance]);

  const setNoticeWithTone = useCallback((text: string, tone: NoticeTone = "info") => {
    setNotice({ text, tone });
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  const onConnectWallet = useCallback(async () => {
    setSessionExpired(false);
  }, []);

  const onDisconnectWallet = useCallback(() => {
    clearWalletSessionTimestamp();
    clearNotice();
    setSessionExpired(true);
    setSessionReady(true);
    setActionEditorOpen(false);
  }, [clearNotice]);

  const syncSessionState = useCallback(() => {
    const nextDemoState = ensureDemoWalletState();
    setDemoWalletState(nextDemoState);
    setSessionExpired(isWalletSessionExpired());
    setSessionReady(true);
  }, []);

  useEffect(() => {
    syncSessionState();

    const onStorageChange = () => {
      syncSessionState();
    };

    window.addEventListener(WALLET_SESSION_CHANGE_EVENT, onStorageChange);
    window.addEventListener("storage", onStorageChange);
    window.addEventListener("focus", onStorageChange);

    return () => {
      window.removeEventListener(WALLET_SESSION_CHANGE_EVENT, onStorageChange);
      window.removeEventListener("storage", onStorageChange);
      window.removeEventListener("focus", onStorageChange);
    };
  }, [syncSessionState]);

  const verifyDeployments = useCallback(async (): Promise<boolean> => {
    if (!publicClient || !contractsReady) return false;
    try {
      const [musdcCode, vaultCode] = await Promise.all([
        publicClient.getBytecode({ address: MUSDC }),
        publicClient.getBytecode({ address: VAULT }),
      ]);
      const hasCode = Boolean(musdcCode && musdcCode !== "0x" && vaultCode && vaultCode !== "0x");
      if (!hasCode) {
        setDeploymentError(DEPLOYMENT_MISSING_MESSAGE);
        return false;
      }
      setDeploymentError("");
      return true;
    } catch (error: unknown) {
      setDeploymentError(getErrorMessage(error, "部署状态校验失败。"));
      return false;
    }
  }, [publicClient, contractsReady, MUSDC, VAULT]);

  const refreshSnapshot = useCallback(async () => {
    if (!publicClient || !contractsReady) return;
    try {
      const deployed = await verifyDeployments();
      if (!deployed) {
        setSnapshot(null);
        setSnapshotError("");
        return;
      }
      const next = await readVaultSnapshot(publicClient, VAULT);
      setSnapshot(next);
      setSnapshotError("");
    } catch (error: unknown) {
      setSnapshotError(getErrorMessage(error, "读取链上池子失败。"));
    }
  }, [publicClient, contractsReady, VAULT, verifyDeployments]);

  const fetchMarketData = useCallback(async () => {
    try {
      const res = await fetch("/api/market-apy?decisionLimit=720", { cache: "no-store" });
      const payload = (await res.json()) as MarketApyApiPayload;
      if (!res.ok || !payload.ok) {
        throw new Error(payload.message || `HTTP ${res.status}`);
      }
      setMarketPayload(payload);
      setMarketError("");
    } catch (error: unknown) {
      setMarketError(getErrorMessage(error, "读取市场 APY 数据失败。"));
    }
  }, []);

  useEffect(() => {
    if (!isConnected || !publicClient || !contractsReady) return;
    void refreshSnapshot();
    const id = window.setInterval(() => void refreshSnapshot(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [isConnected, publicClient, contractsReady, refreshSnapshot]);

  useEffect(() => {
    if (!isConnected || !publicClient || !contractsReady) return;
    void verifyDeployments();
    const id = window.setInterval(() => void verifyDeployments(), REFRESH_MS * 2);
    return () => window.clearInterval(id);
  }, [isConnected, publicClient, contractsReady, verifyDeployments]);

  useEffect(() => {
    if (!isConnected) return;
    void fetchMarketData();
    const id = window.setInterval(() => void fetchMarketData(), MARKET_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [isConnected, fetchMarketData]);

  const poolRows = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.poolAddresses.map((poolAddr, i) => {
      const apyBps = snapshot.poolApysBps[i] ?? 0n;
      const allocated = snapshot.allocations[i] ?? 0n;
      const isActive = poolAddr.toLowerCase() === snapshot.activePool.toLowerCase();
      const isBest = poolAddr.toLowerCase() === snapshot.bestPool.toLowerCase();
      return { index: i + 1, poolAddr, apyBps, allocated, isActive, isBest };
    });
  }, [snapshot]);

  const latestMarketApys = useMemo(() => {
    if (!marketPayload) return [];
    return marketPayload.pools
      .map((pool, index) => {
        if (pool.points.length === 0) return null;
        let latest = pool.points[0];
        for (const point of pool.points) {
          if (point.t > latest.t) latest = point;
        }
        return {
          index,
          id: pool.id,
          name: pool.name,
          apy: latest.apy,
          t: latest.t,
        };
      })
      .filter(
        (item): item is { index: number; id: string; name: string; apy: number; t: number } =>
          item !== null && Number.isFinite(item.apy)
      );
  }, [marketPayload]);

  const latestDecision = useMemo(() => {
    if (!marketPayload || marketPayload.decisions.length === 0) return null;
    return marketPayload.decisions.reduce((latest, item) => (item.t > latest.t ? item : latest));
  }, [marketPayload]);

  const activeApyBps = useMemo(() => {
    const row = poolRows.find((item) => item.isActive);
    return row?.apyBps ?? 0n;
  }, [poolRows]);

  const activeApyPct = useMemo(() => {
    if (latestDecision && Number.isFinite(latestDecision.activeApy)) {
      return latestDecision.activeApy;
    }
    const activeIndex = poolRows.findIndex((item) => item.isActive);
    if (activeIndex >= 0 && activeIndex < latestMarketApys.length) {
      return latestMarketApys[activeIndex].apy;
    }
    return bpsToPct(activeApyBps);
  }, [latestDecision, poolRows, latestMarketApys, activeApyBps]);

  const apyRangeText = useMemo(() => {
    if (latestMarketApys.length > 0) {
      let min = latestMarketApys[0].apy;
      let max = latestMarketApys[0].apy;
      for (const pool of latestMarketApys) {
        if (pool.apy < min) min = pool.apy;
        if (pool.apy > max) max = pool.apy;
      }
      return `${fmtPct(min)} ~ ${fmtPct(max)}`;
    }

    if (!snapshot || snapshot.poolApysBps.length === 0) return "--";
    let min = snapshot.poolApysBps[0];
    let max = snapshot.poolApysBps[0];
    for (const apy of snapshot.poolApysBps) {
      if (apy < min) min = apy;
      if (apy > max) max = apy;
    }
    return `${fmtPct(bpsToPct(min))} ~ ${fmtPct(bpsToPct(max))}`;
  }, [latestMarketApys, snapshot]);

  const apy24hRangeText = useMemo(() => {
    if (marketPayload && marketPayload.pools.length > 0) {
      const endMs = marketPayload.updatedAt || Date.now();
      const startMs = endMs - 24 * 60 * 60 * 1000;
      const values: number[] = [];

      for (const pool of marketPayload.pools) {
        for (const point of pool.points) {
          if (point.t >= startMs && point.t <= endMs && Number.isFinite(point.apy)) {
            values.push(point.apy);
          }
        }
      }

      if (values.length > 0) {
        let min = values[0];
        let max = values[0];
        for (const value of values) {
          if (value < min) min = value;
          if (value > max) max = value;
        }
        return `${fmtPct(min)}~${fmtPct(max)}`;
      }
    }

    return apyRangeText === "--" ? "--" : apyRangeText.replace(/\s+/g, "");
  }, [marketPayload, apyRangeText]);

  async function refreshAllReads() {
    await Promise.all([
      refetchWalletBal(),
      refetchAllowance(),
      refetchShares(),
      refetchTotalShares(),
      refetchVaultTotalAssets(),
      refreshSnapshot(),
      fetchMarketData(),
    ]);
  }

  function getWalletProvider(): WalletProvider | null {
    if (typeof window === "undefined") return null;
    const eth = (window as Window & { ethereum?: WalletProvider }).ethereum;
    if (!eth?.request) return null;
    return eth;
  }

  async function readUserStateFromChain(user: HexAddr): Promise<UserState | null> {
    if (!publicClient) return null;
    const [wallet, shares] = await Promise.all([
      publicClient.readContract({
        address: MUSDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [user],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: VAULT,
        abi: vaultAbi,
        functionName: "sharesOf",
        args: [user],
      }) as Promise<bigint>,
    ]);
    return { wallet, shares };
  }

  async function readUserStateFromWallet(user: HexAddr): Promise<UserState | null> {
    const eth = getWalletProvider();
    if (!eth) return null;

    try {
      const [walletRaw, sharesRaw] = await Promise.all([
        eth.request({
          method: "eth_call",
          params: [
            {
              to: MUSDC,
              data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [user] }),
            },
            "latest",
          ],
        }),
        eth.request({
          method: "eth_call",
          params: [
            {
              to: VAULT,
              data: encodeFunctionData({ abi: vaultAbi, functionName: "sharesOf", args: [user] }),
            },
            "latest",
          ],
        }),
      ]);

      const wallet = decodeFunctionResult({
        abi: erc20Abi,
        functionName: "balanceOf",
        data: walletRaw as `0x${string}`,
      }) as bigint;
      const shares = decodeFunctionResult({
        abi: vaultAbi,
        functionName: "sharesOf",
        data: sharesRaw as `0x${string}`,
      }) as bigint;

      return { wallet, shares };
    } catch {
      return null;
    }
  }

  function didDepositStateChange(before: UserState | null, after: UserState | null): boolean | null {
    if (!before || !after) return null;
    return after.wallet < before.wallet && after.shares > before.shares;
  }

  function didWithdrawStateChange(before: UserState | null, after: UserState | null): boolean | null {
    if (!before || !after) return null;
    return after.wallet > before.wallet && after.shares < before.shares;
  }
  async function waitForTxOnPublicRpc(hash: Hash, attempts: number = 3): Promise<boolean | null> {
    if (!publicClient) return null;
    for (let i = 0; i < attempts; i++) {
      try {
        await publicClient.getTransactionReceipt({ hash });
        return true;
      } catch {
        // retry
      }
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
    return false;
  }

  async function readRpcDiagnostics(hash?: Hash) {
    const eth = getWalletProvider();
    let walletChainId: number | null = null;
    let publicChainId: number | null = null;
    let txSeenOnPublic: boolean | null = null;

    try {
      const chainHex = eth ? ((await eth.request({ method: "eth_chainId" })) as string) : null;
      if (chainHex) walletChainId = Number.parseInt(chainHex, 16);
    } catch {
      // ignore
    }

    try {
      if (publicClient) publicChainId = await publicClient.getChainId();
    } catch {
      // ignore
    }

    if (hash) txSeenOnPublic = await waitForTxOnPublicRpc(hash, 1);
    return { walletChainId, publicChainId, txSeenOnPublic };
  }

  async function assertChainAlignment(): Promise<boolean> {
    const diag = await readRpcDiagnostics();
    const walletOk = diag.walletChainId === EXPECTED_CHAIN_ID;
    const publicOk = diag.publicChainId === EXPECTED_CHAIN_ID;
    const bothKnownMatch =
      diag.walletChainId !== null &&
      diag.publicChainId !== null &&
      diag.walletChainId === diag.publicChainId;

    if (walletOk && publicOk && bothKnownMatch) return true;

    const msg = `钱包与页面连接的链不一致：钱包ID=${diag.walletChainId ?? "?"}，页面ID=${diag.publicChainId ?? "?"}`;
    setNoticeWithTone(msg, "error");
    alert(msg);
    return false;
  }

  async function waitForTxReceiptViaWallet(hash: Hash, timeoutMs: number = TX_WAIT_TIMEOUT_MS) {
    const eth = getWalletProvider();
    if (!eth) throw new Error("未检测到钱包提供器。");

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const receipt = (await eth.request({
        method: "eth_getTransactionReceipt",
        params: [hash],
      })) as WalletTxReceipt | null;

      if (receipt?.blockNumber) return receipt;
      await new Promise((resolve) => window.setTimeout(resolve, TX_WAIT_POLL_MS));
    }

    throw new Error(`交易 ${hash} 等待确认超时。`);
  }

  async function waitForTxReceipt(hash: Hash, label: string): Promise<TxWaitResult> {
    setNoticeWithTone(`${label}已发送，等待链上确认...`, "info");

    try {
      const walletReceipt = await waitForTxReceiptViaWallet(hash);
      if (walletReceipt?.status === "0x0") {
        throw new Error(`${label}执行失败（revert）`);
      }
      const seenOnPublicRpc = await waitForTxOnPublicRpc(hash);
      return { confirmed: true, seenOnPublicRpc };
    } catch (error: any) {
      if (String((error && error.message) || "").includes("reverted")) throw error;
    }

    if (!publicClient) {
      setNoticeWithTone(`${label}回执暂不可用，正在同步状态...`, "info");
      return { confirmed: false, seenOnPublicRpc: null };
    }

    try {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        pollingInterval: TX_WAIT_POLL_MS,
        timeout: TX_WAIT_TIMEOUT_MS,
      });
      if (receipt.status === "reverted") {
        throw new Error(`${label}执行失败（revert）`);
      }
      return { confirmed: true, seenOnPublicRpc: true };
    } catch (error: any) {
      if (String((error && error.message) || "").includes("reverted")) throw error;
      const seenOnPublicRpc = await waitForTxOnPublicRpc(hash);
      return { confirmed: false, seenOnPublicRpc };
    }
  }

  function parseInputAmount(input: string): bigint | null {
    const value = input.trim();
    if (!value) return null;
    try {
      const raw = parseUnits(value, decimals);
      return raw > 0n ? raw : null;
    } catch {
      return null;
    }
  }

  function fillDepositMax() {
    setDepositInput(walletBalText);
  }

  function fillWithdrawMax() {
    setWithdrawInput(vaultBalText);
  }

  async function onDeposit() {
    if (!isConnected || busy) return;

    const amountRaw = parseInputAmount(depositInput);
    if (!amountRaw) {
      setNoticeWithTone("请输入有效的存入数量。", "error");
      return;
    }
    if (walletBalRaw < amountRaw) {
      setNoticeWithTone("钱包余额不足。", "error");
      return;
    }

    setBusy(true);
    try {
      const amount = Number(formatUnits(amountRaw, decimals));
      const nextState = applyDemoWalletDeposit(amount);
      if (!nextState) {
        setNoticeWithTone("钱包余额不足。", "error");
        return;
      }
      setDemoWalletState(nextState);
      setDepositInput("");
      setActionEditorOpen(false);
      toast.success("存入成功，页面状态已更新。");
    } catch (error: unknown) {
      setNoticeWithTone(getErrorMessage(error, "存入失败。"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function onWithdraw() {
    if (!isConnected || busy) return;

    const requestedAssetsRaw = parseInputAmount(withdrawInput);
    if (!requestedAssetsRaw) {
      setNoticeWithTone("请输入有效的取出数量。", "error");
      return;
    }
    if (requestedAssetsRaw > userAssetsInVaultRaw) {
      setNoticeWithTone("可取资产不足。", "error");
      return;
    }

    setBusy(true);
    try {
      const amount = Number(formatUnits(requestedAssetsRaw, decimals));
      const nextState = applyDemoWalletWithdraw(amount);
      if (!nextState) {
        setNoticeWithTone("可取资产不足。", "error");
        return;
      }
      setDemoWalletState(nextState);
      setWithdrawInput("");
      setActionEditorOpen(false);
      toast.success("取出成功，页面状态已更新。");
    } catch (error: unknown) {
      setNoticeWithTone(getErrorMessage(error, "取出失败。"), "error");
    } finally {
      setBusy(false);
    }
  }
  const poolSeries = useMemo(() => {
    if (!marketPayload || marketPayload.pools.length === 0) return [];
    return marketPayload.pools.map((pool) => ({
      name: pool.name,
      color: pool.color,
      points: pool.points.map((item) => [item.t, Number(item.apy.toFixed(4))] as ChartPoint),
    }));
  }, [marketPayload]);

  const sharedTimelineRange = useMemo(() => {
    const allPoints = poolSeries.flatMap((pool) => pool.points);
    if (allPoints.length === 0) return null;

    let start = allPoints[0][0];
    let end = allPoints[0][0];
    for (const [t] of allPoints) {
      if (t < start) start = t;
      if (t > end) end = t;
    }

    return { start, end };
  }, [poolSeries]);
  const sharedTimelineStart = sharedTimelineRange?.start;
  const sharedTimelineEnd = sharedTimelineRange?.end;
  const timelineInitialStart = useMemo(() => {
    if (sharedTimelineStart == null || sharedTimelineEnd == null) return undefined;
    if (TIMELINE_INITIAL_START_MS >= sharedTimelineEnd) return sharedTimelineStart;
    return Math.max(sharedTimelineStart, TIMELINE_INITIAL_START_MS);
  }, [sharedTimelineStart, sharedTimelineEnd]);

  const decisionSeries = useMemo(() => buildDecisionSeries(marketPayload), [marketPayload]);

  const apyOption = useMemo<Record<string, unknown>>(() => {
    return {
      legend: { top: 0, textStyle: { color: "rgba(30,41,59,0.88)", fontSize: 12 } },
      grid: { left: 56, right: 22, top: 110, bottom: 68 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "time",
        min: sharedTimelineStart,
        max: sharedTimelineEnd,
        axisLabel: { color: "rgba(71,85,105,0.9)", formatter: (v: number) => fmtAxis(v) },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "rgba(71,85,105,0.9)", formatter: (v: number) => `${v.toFixed(1)}%` },
      },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 24, bottom: 16 }],
      series: poolSeries.map((pool) => ({
        name: pool.name,
        type: "line",
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 2.2, color: pool.color },
        data: pool.points,
      })),
    };
  }, [poolSeries, sharedTimelineStart, sharedTimelineEnd]);

  const timelineOption = useMemo<Record<string, unknown>>(() => {
    return {
      legend: { top: 0, textStyle: { color: "rgba(30,41,59,0.88)", fontSize: 12 } },
      grid: { left: 56, right: 22, top: 52, bottom: 72 },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const rows = (Array.isArray(params) ? params : [params]) as Array<{
            axisValue?: number;
            value?: [number, number];
            marker: string;
            seriesName: string;
            data?: DecisionPoint;
          }>;
          if (!rows.length) return "";
          const t = Number(rows[0].axisValue ?? rows[0].value?.[0] ?? 0);
          const reason = rows.find((row) => row.data)?.data?.reason;
          const lines = [fmtDateTime(t), reason ? `原因：${reasonLabel(reason)}` : ""];
          for (const row of rows) {
            const value = Number(row.value?.[1] ?? 0);
            if (row.seriesName === "调仓执行") {
              lines.push(`${row.marker}${row.seriesName}: ${value > 0 ? "是" : "否"}`);
            } else {
              lines.push(`${row.marker}${row.seriesName}: ${value.toFixed(2)}%`);
            }
          }
          return lines.filter(Boolean).join("<br/>");
        },
      },
      xAxis: {
        type: "time",
        min: sharedTimelineStart,
        max: sharedTimelineEnd,
        axisLabel: { color: "rgba(71,85,105,0.9)", formatter: (v: number) => fmtAxis(v) },
      },
      yAxis: [
        {
          type: "value",
          name: "APY差值",
          axisLabel: { color: "rgba(71,85,105,0.9)", formatter: (v: number) => `${v.toFixed(1)}%` },
          nameTextStyle: { color: "rgba(71,85,105,0.8)" },
        },
        {
          type: "value",
          min: 0,
          max: 1,
          interval: 1,
          name: "执行",
          axisLabel: {
            color: "rgba(71,85,105,0.9)",
            formatter: (v: number) => (v === 1 ? "调仓" : "跳过"),
          },
          nameTextStyle: { color: "rgba(71,85,105,0.8)" },
        },
      ],
      dataZoom: [
        {
          type: "inside",
          startValue: timelineInitialStart,
          endValue: sharedTimelineEnd,
        },
        {
          type: "slider",
          height: 24,
          bottom: 16,
          startValue: timelineInitialStart,
          endValue: sharedTimelineEnd,
        },
      ],
      series: [
        {
          name: "APY差值",
          type: "line",
          showSymbol: false,
          smooth: true,
          lineStyle: { width: 2.2, color: "#fbbf24" },
          data: decisionSeries.map((item) => [item.t, item.deltaPct]),
        },
        {
          name: "调仓执行",
          type: "bar",
          yAxisIndex: 1,
          itemStyle: { color: "rgba(45,212,191,0.75)" },
          barWidth: 10,
          data: decisionSeries.map((item) => ({ value: [item.t, item.rebalance], ...item })),
        },
      ],
    };
  }, [decisionSeries, sharedTimelineEnd, sharedTimelineStart, timelineInitialStart]);

  const syncMs = Math.max(snapshot?.fetchedAtMs ?? 0, marketPayload?.updatedAt ?? 0);

  const statusItems = useMemo(
    () => [
      {
        label: "网络状态",
        value: wrongChain
          ? `链ID异常：${chainId ?? "--"}（应为 ${EXPECTED_CHAIN_ID}）`
          : `本地测试链 ${EXPECTED_CHAIN_ID}`,
        tone: wrongChain ? ("error" as const) : ("ok" as const),
      },
      {
        label: "数据同步",
        value: syncMs ? fmtDateTime(syncMs) : "等待首次同步",
        tone: syncMs ? ("ok" as const) : ("warn" as const),
      },
      {
        label: "钱包状态",
        value: isConnected && address ? `已连接 ${shortAddress(address)}` : "未连接",
        tone: isConnected ? ("ok" as const) : ("warn" as const),
      },
      {
        label: "部署状态",
        value: deploymentError ? "未就绪" : "合约已就绪",
        tone: deploymentError ? ("error" as const) : ("ok" as const),
      },
    ],
    [wrongChain, chainId, syncMs, isConnected, address, deploymentError]
  );

  if (!sessionReady) {
    return (
      <ConsoleLayout title="控制台" subtitle="正在校验钱包会话状态...">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-[0_16px_38px_rgba(15,23,42,0.08)]">
          正在检查上次钱包连接时间。
        </section>
      </ConsoleLayout>
    );
  }

  if (sessionExpired || !isConnected) {
    return (
      <ConsoleLayout title="登录页" hidePageHeader>
        <WalletEntryScreen
          title="机枪池钱包登录"
          description="请先确认默认用户信息，再以演示方式登录控制台，本流程不会真实连接钱包。"
        />
      </ConsoleLayout>
    );
  }

  return (
    <ConsoleLayout
      title="控制台"
      hidePageHeader
      rightSlot={
        <WalletMenu
          address={address}
          isConnected={isConnected}
          isConnecting={isConnecting}
          onConnect={() => void onConnectWallet()}
          onDisconnect={onDisconnectWallet}
        />
      }
    >
      <div className="grid gap-4">
        {(snapshotError || marketError || deploymentError || (wrongChain && isConnected)) ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {snapshotError ? <div>{`链上读取异常：${snapshotError}`}</div> : null}
            {marketError ? <div>{`市场数据异常：${marketError}`}</div> : null}
            {deploymentError ? <div>{deploymentError}</div> : null}
            {wrongChain && isConnected ? (
              <div>{`当前钱包链 ID 为 ${chainId}，请切换到 ${EXPECTED_CHAIN_ID}。`}</div>
            ) : null}
          </section>
        ) : null}

        {/* Stats cards */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {/* WALLET */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
            <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-blue-500" />
            <div className="pt-2 text-center">
              <div className="flex items-center justify-center gap-2">
                <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[10px] font-bold tracking-[0.18em] text-blue-700">
                  WALLET
                </span>
                <span className="text-sm font-semibold text-slate-500">钱包余额</span>
              </div>
              <div className="mt-2 flex items-end justify-center gap-1.5">
                <span className="text-[32px] font-black leading-none tabular-nums text-slate-900">{walletBalText}</span>
                <span className="mb-0.5 text-sm font-semibold text-slate-400">mUSDC</span>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => { setTab("deposit"); setActionEditorOpen(true); }}
                  style={{ backgroundColor: "#003689", color: "#ffffff" }}
                  className="flex-1 rounded-xl py-1.5 text-sm font-bold transition hover:opacity-90"
                >
                  存入
                </button>
                <button
                  type="button"
                  onClick={() => { setTab("withdraw"); setActionEditorOpen(true); }}
                  style={{ border: "1px solid #003689", color: "#003689" }}
                  className="flex-1 rounded-xl py-1.5 text-sm font-bold transition hover:opacity-80"
                >
                  取出
                </button>
              </div>
            </div>
          </div>

          {/* VAULT */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
            <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-emerald-500" />
            <div className="pt-2 text-center">
              <div className="flex items-center justify-center gap-2">
                <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold tracking-[0.18em] text-emerald-700">
                  VAULT
                </span>
                <span className="text-sm font-semibold text-slate-500">资金池余额</span>
              </div>
              <div className="mt-2 flex items-end justify-center gap-1.5">
                <span className="text-[32px] font-black leading-none tabular-nums text-slate-900">{vaultBalText}</span>
                <span className="mb-0.5 text-sm font-semibold text-slate-400">mUSDC</span>
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-500">您在机枪池中持有的资产份额价值</p>
            </div>
          </div>

          {/* APY */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
            <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-amber-400" />
            <div className="pt-2 text-center">
              <div className="flex items-center justify-center gap-2">
                <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold tracking-[0.18em] text-amber-700">
                  APY
                </span>
                <span className="text-sm font-semibold text-slate-500">{"\u6536\u76ca\u6c34\u5e73"}</span>
              </div>
              <div className="mt-2 flex items-end justify-center gap-1.5">
                <span className="text-[32px] font-black leading-none tabular-nums text-slate-900">{fmtPct(activeApyPct)}</span>
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-500">{"\u5c55\u793a\u5f53\u524d\u8d44\u91d1\u6240\u5728\u4e3b\u6c60\u7684\u6536\u76ca\u6c34\u5e73"}</p>
              <div className="mt-1 text-xs leading-5 text-slate-400">{`\u8fc724h APY\u533a\u95f4 ${apyRangeText}`}</div>
            </div>
          </div>

          {/* STATUS */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
            <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-violet-500" />
            <div className="pt-2 text-center">
              <div className="flex items-center justify-center gap-2">
                <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-bold tracking-[0.18em] text-violet-700">
                  STATUS
                </span>
                <span className="text-sm font-semibold text-slate-500">{STATUS_TEXT.title}</span>
              </div>
              <div className={`mt-2 text-[28px] font-black leading-none ${isConnected ? "text-emerald-600" : "text-rose-500"}`}>
                {isConnected ? STATUS_TEXT.running : STATUS_TEXT.disconnected}
              </div>
              <div className="mt-4 grid grid-cols-[auto_auto_1fr] items-center gap-x-4">
                <div className="space-y-1 text-left">
                  {statusItems.slice(0, 2).map((item) => (
                    <div key={`${item.label}-label-clean`} className="flex min-h-[24px] items-center text-xs leading-5 text-slate-500">
                      {item.label}
                    </div>
                  ))}
                </div>
                <div className="space-y-1 justify-self-center">
                  {statusItems.slice(0, 2).map((item) => (
                    <div key={`${item.label}-badge-clean`} className="flex min-h-[24px] items-center">
                      <span className={`inline-flex min-w-[44px] shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-center text-xs font-semibold ${
                        item.tone === "ok" ? "bg-emerald-50 text-emerald-700" :
                        item.tone === "warn" ? "bg-amber-50 text-amber-700" :
                        item.tone === "error" ? "bg-rose-50 text-rose-700" :
                        "bg-slate-50 text-slate-600"
                      }`}>
                        {item.tone === "ok"
                          ? STATUS_TEXT.ok
                          : item.tone === "warn"
                            ? STATUS_TEXT.warn
                            : item.tone === "error"
                              ? STATUS_TEXT.error
                              : "--"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="justify-self-end">
                  <button
                    type="button"
                    onClick={() => setSummaryOpen((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50/80 px-3.5 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      className={`h-3.5 w-3.5 transition-transform ${summaryOpen ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M4 6l4 4 4-4" />
                    </svg>
                    {summaryOpen ? STATUS_TEXT.collapse : STATUS_TEXT.expand}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {summaryOpen ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            <div className="grid gap-2">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {statusItems.map((item) => (
                  <div
                    key={item.label}
                    className={`rounded-xl border px-3 py-3 text-xs ${statusToneClass(item.tone ?? "neutral")}`}
                  >
                    <div className="text-[11px] text-slate-500">{item.label}</div>
                    <div className="mt-1 font-bold">{item.value}</div>
                  </div>
                ))}
              </div>
              <div className="grid gap-2 xl:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  钱包地址：{shortAddress(address)}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  合约地址：mUSDC {shortAddress(MUSDC)} · Vault {shortAddress(VAULT)}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  最近决策时间：{latestDecision ? fmtDateTime(latestDecision.t) : "--"}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                过去24h年化区间：{apy24hRangeText}
              </div>
            </div>
          </section>
        ) : null}

        {/* ActionPanel — dialog only, buttons live in the WALLET card above */}
        <ActionPanel
          mode={tab}
          onModeChange={setTab}
          editorOpen={actionEditorOpen}
          onOpenEditor={() => setActionEditorOpen(true)}
          onCloseEditor={() => setActionEditorOpen(false)}
          depositValue={depositInput}
          withdrawValue={withdrawInput}
          onDepositValueChange={setDepositInput}
          onWithdrawValueChange={setWithdrawInput}
          onDeposit={onDeposit}
          onWithdraw={onWithdraw}
          onFillDepositMax={fillDepositMax}
          onFillWithdrawMax={fillWithdrawMax}
          walletBalanceText={walletBalText}
          vaultBalanceText={vaultBalText}
          isConnected={isConnected}
          isConnecting={isConnecting}
          onConnect={() => void onConnectWallet()}
          busy={busy}
          submitDisabled={!isConnected || busy}
          noticeText={notice?.text}
          noticeTone={notice?.tone}
          noButtons
          embedded
        />

        <section className="grid gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-black text-slate-900">当前收益</h2>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-base font-bold text-slate-900">多池 APY 曲线</h3>
              </div>
              {poolSeries.length > 0 ? (
                <ReactECharts option={apyOption} style={{ height: 320, width: "100%" }} notMerge />
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-600">
                  {"暂无 APY 曲线数据。"}
                </div>
              )}
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-base font-bold text-slate-900">调仓时间线</h3>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">{"APY差值与执行结果"}</span>
              </div>
              {decisionSeries.length > 0 ? (
                <ReactECharts option={timelineOption} style={{ height: 320, width: "100%" }} notMerge />
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-600">
                  {"暂无调仓时间线数据。"}
                </div>
              )}
            </article>
          </div>
        </section>
      </div>
    </ConsoleLayout>
  );
}
