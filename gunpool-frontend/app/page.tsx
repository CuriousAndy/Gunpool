import { ConsoleLayout } from "@/src/components/layout/console-layout";
import { WalletEntryScreen } from "@/src/components/ui/wallet-entry-screen";

export default function HomePage() {
  return (
    <ConsoleLayout title="登录页" hidePageHeader>
      <WalletEntryScreen
        title="机枪池钱包登录"
        description="点击中间按钮后先确认默认用户信息，再以演示方式登录控制台。"
      />
    </ConsoleLayout>
  );
}
