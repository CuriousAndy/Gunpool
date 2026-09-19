"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  type DemoLoginProfile,
  WalletConnectModal,
} from "@/src/components/ui/wallet-connect-modal";
import { WalletLoadingModal } from "@/src/components/ui/wallet-loading-modal";
import { WalletLoginPanel } from "@/src/components/ui/wallet-login-panel";
import { DEMO_WALLET_ADDRESS, ensureDemoWalletState } from "@/src/lib/demo-wallet";
import {
  WALLET_SESSION_CHANGE_EVENT,
  isWalletSessionExpired,
  markWalletConnectedNow,
} from "@/src/lib/wallet-session";

type WalletEntryScreenProps = {
  title?: string;
  description?: string;
};

const DEFAULT_DEMO_PROFILE: DemoLoginProfile = {
  displayName: "机枪池演示用户",
  walletLabel: "GunPool Demo Wallet",
  role: "演示账户",
};

export function WalletEntryScreen({
  title = "机枪池钱包登录",
  description = "以演示身份进入控制台，查看资金池状态、调仓分析与策略对比，可先确认身份或直接快速进入。",
}: WalletEntryScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loadingOpen, setLoadingOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [profile, setProfile] = useState<DemoLoginProfile>(DEFAULT_DEMO_PROFILE);
  const [isConnected, setIsConnected] = useState(() => {
    if (typeof window === "undefined") return false;
    return !isWalletSessionExpired();
  });

  const navigateToConsole = useCallback(() => {
    router.replace("/console");

    window.setTimeout(() => {
      if (window.location.pathname !== "/console") {
        window.location.assign("/console");
      }
    }, 180);
  }, [router]);

  useEffect(() => {
    ensureDemoWalletState();
    void router.prefetch("/console");
  }, [router]);

  useEffect(() => {
    if (!isConnected || isPending || pathname === "/console") return;
    navigateToConsole();
  }, [isConnected, isPending, navigateToConsole, pathname]);

  useEffect(() => {
    const syncSession = () => {
      setIsConnected(!isWalletSessionExpired());
    };

    syncSession();
    window.addEventListener(WALLET_SESSION_CHANGE_EVENT, syncSession);
    window.addEventListener("storage", syncSession);
    window.addEventListener("focus", syncSession);
    return () => {
      window.removeEventListener(WALLET_SESSION_CHANGE_EVENT, syncSession);
      window.removeEventListener("storage", syncSession);
      window.removeEventListener("focus", syncSession);
    };
  }, []);

  async function onConfirmConnect() {
    if (isPending) return;

    setIsPending(true);
    setDialogOpen(false);
    setLoadingOpen(true);
    ensureDemoWalletState();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 2000));
    markWalletConnectedNow();
    setIsConnected(true);
    setLoadingOpen(false);
    setIsPending(false);
    navigateToConsole();
  }

  async function onQuickEnter() {
    if (isPending || isConnected) return;
    setProfile({ ...DEFAULT_DEMO_PROFILE });
    await onConfirmConnect();
  }

  return (
    <>
      <WalletLoginPanel
        title={title}
        description={description}
        isPending={isPending}
        isConnected={isConnected}
        onConnectWallet={() => setDialogOpen(true)}
        onQuickEnter={onQuickEnter}
      />
      <WalletConnectModal
        open={dialogOpen}
        address={DEMO_WALLET_ADDRESS}
        profile={profile}
        isPending={isPending}
        onClose={() => {
          if (isPending) return;
          setDialogOpen(false);
        }}
        onConfirm={onConfirmConnect}
        onProfileChange={(field, value) => {
          setProfile((current) => ({
            ...current,
            [field]: value,
          }));
        }}
      />
      <WalletLoadingModal open={loadingOpen} />
    </>
  );
}
