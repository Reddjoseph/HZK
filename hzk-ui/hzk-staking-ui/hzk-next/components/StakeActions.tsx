"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import React from "react";
import { toast } from "sonner";

export default function StakeActions({
  stakeAmount,
  setStakeAmount,
  stake,
  unstake,
  claim,
  disabled,
}: {
  stakeAmount: number | "";
  setStakeAmount: (v: number | "") => void;
  stake: () => Promise<void> | void;
  unstake: () => Promise<void> | void;
  claim: () => Promise<void> | void;
  disabled?: boolean;
}) {
  const [loadingStake, setLoadingStake] = React.useState(false);
  const [loadingUnstake, setLoadingUnstake] = React.useState(false);
  const [loadingClaim, setLoadingClaim] = React.useState(false);

  function onAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (v === "") return setStakeAmount("");
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return; // numeric validation
    setStakeAmount(n);
  }

  async function doStake() {
    setLoadingStake(true);
    try {
      await Promise.resolve(stake());
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
      await Promise.resolve(unstake());
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
      await Promise.resolve(claim());
      toast.success("Claim successful");
    } catch (e: any) {
      toast.error(e?.message || "Claim failed");
    } finally {
      setLoadingClaim(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="block text-sm mb-2">Amount to stake (whole tokens)</label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="1"
            value={stakeAmount}
            onChange={onAmountChange}
            placeholder="0"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button onClick={doStake} loading={loadingStake} disabled={disabled}>Stake</Button>
          <Button onClick={doUnstake} variant="secondary" loading={loadingUnstake} disabled={disabled}>Unstake</Button>
          <Button onClick={doClaim} variant="outline" loading={loadingClaim} disabled={disabled}>Claim rewards</Button>
        </div>
      </CardContent>
    </Card>
  );
}
