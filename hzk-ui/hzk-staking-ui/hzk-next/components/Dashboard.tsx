"use client";
import DevnetNote from "@/components/DevnetNote";
import { useStaking } from "@/hooks/useStaking";
import { useWallet } from "@solana/wallet-adapter-react";
import ActionStatusCard from "@/components/ActionStatusCard";

export default function Dashboard() {
  const staking = useStaking();
  const { publicKey, connected } = useWallet();
  const stakedAmount = staking.userState?.account?.amount ? staking.formatTokenAmount(staking.userState.account.amount) : null;

  return (
    <div className="min-h-screen text-white p-6">
      <div className="max-w-6xl mx-auto">
        <header className="py-6">
          <h1 className="text-2xl font-bold">HZK Staking Dashboard</h1>
        </header>

        <div className="grid grid-cols-1 gap-6">
          <ActionStatusCard />
        </div>

        <DevnetNote />
      </div>
    </div>
  );
}
