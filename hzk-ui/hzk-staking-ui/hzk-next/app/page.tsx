"use client";
import Hero from "@/components/ui/animated-shader-hero";
import { useRouter } from "next/navigation";

export default function Page() {
  const router = useRouter();

  return (
    <Hero
      trustBadge={{ text: "Trusted by forward-thinking teams.", icons: ["✨"] }}
      headline={{ line1: "Launch Your", line2: "Workflow Into Orbit" }}
      subtitle="Supercharge productivity with AI-powered automation and integrations built for the next generation of teams — fast, seamless, and limitless."
      buttons={{
        primary: { text: "Get Started for Free", onClick: () => router.push("/dashboard") },
        secondary: { text: "Explore Features", onClick: () => window.scrollTo({ top: window.innerHeight, behavior: "smooth" }) },
      }}
    />
  );
}
