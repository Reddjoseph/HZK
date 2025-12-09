"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWallet } from "@solana/wallet-adapter-react";
import AddressText from "@/components/AddressText";

export default function WalletCard() {
  const { publicKey, connected } = useWallet();

  return (
    <Card className="shadow-md shadow-black/5">
      <CardHeader className="flex flex-row items-center gap-3">
        <img src="/phantom.svg" alt="Phantom" className="h-5 w-5" />
        <CardTitle>Wallet</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center justify-center min-h-10">
          {connected ? (
            <AddressText value={publicKey?.toString()} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
