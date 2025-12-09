"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AddressText from "@/components/AddressText";

export default function UserStatus({ address, staked }: { address?: string | null; staked?: string | null }) {
  const isConnected = !!address;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>
          <span className="text-muted-foreground">Your address:</span>
          <span className="ml-2 font-mono">
            {isConnected ? <AddressText value={address || undefined} /> : <span className="text-muted-foreground">—</span>}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Your staked:</span>
          <span className="ml-2">{staked ?? "—"}</span>
        </div>
      </CardContent>
    </Card>
  );
}
