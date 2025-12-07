"use client";
import Hero from "@/components/ui/animated-shader-hero";
import { useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

function LandingContent() {
  const { publicKey, connect, select } = useWallet();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [localPubkey, setLocalPubkey] = useState<string | null>(null);

  function onConnectClick() {
    setError("");
    setIsOpen(true);
  }

  async function handlePhantomConnect() {
    setError("");
    const provider = typeof window !== "undefined" ? (window as any).solana : null;
    if (!provider || !provider.isPhantom) {
      setError("Phantom wallet not found. Install it to continue.");
      return;
    }
    try {
      setConnecting(true);
      const resp = await provider.connect();
      const keyStr =
        (resp?.publicKey && resp.publicKey.toString && resp.publicKey.toString()) ||
        (provider.publicKey && provider.publicKey.toString && provider.publicKey.toString()) ||
        "";
      if (keyStr) setLocalPubkey(keyStr);
      try {
        // Ensure the app's wallet context is connected so the dashboard can read it
        if (select) {
          // Name for Phantom adapter is "Phantom"
          select("Phantom" as any);
        }
        await connect();
      } catch (_) {}
      setIsOpen(false);
      router.push("/dashboard");
    } catch (e: any) {
      if (e?.code === 4001) {
        setError("Connection request was rejected.");
      } else {
        setError("Failed to connect. Try again.");
      }
    } finally {
      setConnecting(false);
    }
  }

  return (
    <>
      <Hero
        trustBadge={{ text: "Powered by the Hanzenko Ecosystem" }}
        headline={{ line1: "Stake, Earn,", line2: "and Grow Your HZK" }}
        subtitle="Unlock the full potential of the Hanzenko Token with secure on-chain staking, real-time rewards, and seamless wallet integration built for the next generation of decentralized users — simple, fast, and reliable."
        buttons={{
          primary: { text: "Connect Wallet", onClick: onConnectClick },
        }}
      />

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900/90 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Connect a wallet on Solana to continue</h3>
            <div className="mt-5 space-y-3">
              <button
                onClick={handlePhantomConnect}
                disabled={connecting}
                className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-left text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <img src="/phantom.svg" alt="Phantom" className="h-6 w-6" />
                <span className="font-medium">Phantom</span>
                <span className="ml-auto text-sm text-white/70">{connecting ? "Connecting…" : ""}</span>
              </button>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <p className="text-xs text-white/60">
                Don&apos;t have Phantom? <a href="https://phantom.app/download" target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline">Install it</a>
              </p>
            </div>
            <div className="mt-6 flex justify-end">
              <button onClick={() => setIsOpen(false)} className="rounded-md px-3 py-1.5 text-sm text-white/80 hover:text-white">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function Page() {
  return (
    <LandingContent />
  );
}
