import { ConsoleLayout } from "@/src/components/layout/console-layout";
import { WalletEntryScreen } from "@/src/components/ui/wallet-entry-screen";

export default function WalletLoginPage() {
  return (
    <ConsoleLayout title="登录页" hidePageHeader>
      <WalletEntryScreen
        title="机枪池钱包登录"
        description="以演示身份进入控制台，查看资金池状态、调仓分析与策略对比，可先确认身份或直接快速进入。"
      />
    </ConsoleLayout>
  );
}
