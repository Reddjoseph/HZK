"use client";
import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useStaking } from "@/hooks/useStaking";
import { useWallet } from "@solana/wallet-adapter-react";
import AddressText from "@/components/AddressText";
import { toast } from "sonner";

export default function ActionStatusCard() {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = React.useState(false);
  const staking = useStaking();
  const { connected, publicKey } = useWallet();

  // 3D tilt effect based on design reference
  React.useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateY = ((x - centerX) / centerX) * 8;
      const rotateX = ((y - centerY) / centerY) * -8;
      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    };
    const handleMouseEnter = () => setIsHovered(true);
    const handleMouseLeave = () => {
      card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg)";
      setIsHovered(false);
    };

    card.addEventListener("mousemove", handleMouseMove);
    card.addEventListener("mouseenter", handleMouseEnter);
    card.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      card.removeEventListener("mousemove", handleMouseMove);
      card.removeEventListener("mouseenter", handleMouseEnter);
      card.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  const [loadingStake, setLoadingStake] = React.useState(false);
  const [loadingUnstake, setLoadingUnstake] = React.useState(false);
  const [loadingClaim, setLoadingClaim] = React.useState(false);

  function onAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (v === "") return staking.setStakeAmount("");
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return;
    staking.setStakeAmount(n);
  }

  async function doStake() {
    setLoadingStake(true);
    try {
      await Promise.resolve(staking.stake());
      toast.success("Stake successful");
    } catch (e: any) {
      toast.error(e?.message || "Stake failed");
    } finally {
      setLoadingStake(false);
    }
  }
  async function doUnstake() {
    setLoadingUnstake(true);
    try {
      await Promise.resolve(staking.unstake());
      toast.success("Unstake successful");
    } catch (e: any) {
      toast.error(e?.message || "Unstake failed");
    } finally {
      setLoadingUnstake(false);
    }
  }
  async function doClaim() {
    setLoadingClaim(true);
    try {
      await Promise.resolve(staking.claim());
      toast.success("Claim successful");
    } catch (e: any) {
      toast.error(e?.message || "Claim failed");
    } finally {
      setLoadingClaim(false);
    }
  }

  const addressStr = connected && publicKey ? publicKey.toString() : null;
  const stakedDisplay = staking.userState?.account?.amount
    ? staking.formatTokenAmount(staking.userState.account.amount)
    : "—";

  return (
    <div className="w-full px-4">
      <div
        ref={cardRef}
        className="w-full max-w-2xl mx-auto rounded-2xl p-8 transition-all duration-300 ease-out bg-white/5 border border-white/10 shadow-[0_1px_3px_rgba(0,0,0,0.3),0_10px_40px_rgba(0,0,0,0.4)]"
        style={{ transformStyle: "preserve-3d" }}
      >
        {/* Actions */}
        <div className="mb-6">
          <h2 className="text-2xl font-semibold mb-1 text-white">Actions</h2>
          <p className="text-sm text-white/60">Amount to stake (whole tokens)</p>
        </div>

        <div className="space-y-4">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="1"
            value={staking.stakeAmount}
            onChange={onAmountChange}
            placeholder="0"
            className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button onClick={doStake} loading={loadingStake} disabled={!connected} className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600">
              Stake
            </Button>
            <Button onClick={doUnstake} loading={loadingUnstake} disabled={!connected} className="bg-amber-500 hover:bg-amber-600">
              Unstake
            </Button>
            <Button onClick={doClaim} loading={loadingClaim} disabled={!connected} variant="outline" className="border-white/30 hover:bg-white/10">
              Claim rewards
            </Button>
          </div>
        </div>

        {/* Divider */}
        <div className="my-8 h-px bg-white/10" />

        {/* Status */}
        <div className="space-y-2">
          <h3 className="text-xl font-semibold text-white mb-2">Status</h3>
          <div className="text-sm">
            <span className="text-white/60">Your address:</span>
            <span className="ml-2 font-mono">
              {addressStr ? <AddressText value={addressStr} /> : <span className="text-white/40">—</span>}
            </span>
          </div>
          <div className="text-sm">
            <span className="text-white/60">Your staked:</span>
            <span className="ml-2">{stakedDisplay}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
