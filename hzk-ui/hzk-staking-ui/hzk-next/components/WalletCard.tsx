"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wallet } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import AddressText from "@/components/AddressText";

export default function WalletCard() {
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();

  return (
    <Card className="shadow-md shadow-black/5">
      <CardHeader className="flex flex-row items-center gap-3">
        <img src="/phantom.svg" alt="Phantom" className="h-5 w-5" />
        <CardTitle>Wallet</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {!connected ? (
          <div className="flex items-center justify-center">
            <Button className="w-full max-w-xs rounded-2xl" onClick={() => setVisible(true)}>
              Connect wallet
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-center">
            <AddressText value={publicKey?.toString()} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
