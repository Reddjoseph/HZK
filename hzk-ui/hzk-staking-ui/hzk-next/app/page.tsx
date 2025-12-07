"use client";
import Hero from "@/components/ui/animated-shader-hero";
import { useRouter } from "next/navigation";

export default function Page() {
  const router = useRouter();

  return (
    <Hero
      trustBadge={{ text: "Powered by the Hanzenko Ecosystem" }}
      headline={{ line1: "Stake, Earn,", line2: "and Grow Your HZK" }}
      subtitle="Unlock the full potential of the Hanzenko Token with secure on-chain staking, real-time rewards, and seamless wallet integration built for the next generation of decentralized users — simple, fast, and reliable."
      buttons={{
        primary: { text: "Connect Wallet", onClick: () => router.push("/dashboard") },
      }}
    />
  );
}
