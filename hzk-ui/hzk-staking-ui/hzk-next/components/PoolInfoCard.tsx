"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AddressText from "@/components/AddressText";

function fmt(n?: string | number | null) {
  if (n == null) return "0";
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return Intl.NumberFormat().format(x);
}

export default function PoolInfoCard({ pool, loading, lastUpdatedPair }: { pool: any; loading: boolean; lastUpdatedPair: string; }) {
  const parsed = pool?.serializable?._parsed;
  const auth = parsed?.authority ?? pool?.serializable?.authority;
  const mint = parsed?.rewardMint ?? pool?.serializable?.rewardMint;
  const vault = parsed?.rewardVault ?? pool?.serializable?.rewardVault;
  const rate = parsed?.rewardRatePerSecond ?? pool?.serializable?.rewardRatePerSecond;
  const total = parsed?.totalStaked ?? pool?.serializable?.totalStaked;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pool Info</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {loading && <div>Loading...</div>}
        {!loading && (
          <>
            <div>
              <span className="text-muted-foreground">Authority:</span>
              <span className="ml-2 font-mono"><AddressText value={auth} /></span>
            </div>
            <div>
              <span className="text-muted-foreground">Reward Mint:</span>
              <span className="ml-2 font-mono"><AddressText value={mint} /></span>
            </div>
            <div>
              <span className="text-muted-foreground">Reward Vault:</span>
              <span className="ml-2 font-mono"><AddressText value={vault} /></span>
            </div>
            <div>
              <span className="text-muted-foreground">Reward rate / sec:</span>
              <span className="ml-2">{fmt(rate)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total staked:</span>
              <span className="ml-2">{fmt(total)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Last updated (unix sec):</span>
              <span className="ml-2">{lastUpdatedPair}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
