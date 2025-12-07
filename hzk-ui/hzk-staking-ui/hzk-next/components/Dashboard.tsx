"use client";
import WalletCard from "@/components/WalletCard";
import StakeActions from "@/components/StakeActions";
import UserStatus from "@/components/UserStatus";
import DevnetNote from "@/components/DevnetNote";
import { useStaking } from "@/hooks/useStaking";
import { useWallet } from "@solana/wallet-adapter-react";

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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <WalletCard />
          </div>
          <div className="space-y-6">
            <StakeActions
              stakeAmount={staking.stakeAmount}
              setStakeAmount={staking.setStakeAmount}
              stake={staking.stake}
              unstake={staking.unstake}
              claim={staking.claim}
              disabled={!connected}
            />
            <UserStatus
              address={publicKey ? publicKey.toString() : null}
              staked={stakedAmount}
            />
          </div>
        </div>

        <DevnetNote />
      </div>
    </div>
  );
}
