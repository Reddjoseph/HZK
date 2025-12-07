"use client";
import WalletProviders from "@/components/WalletProviders";
import BufferPolyfill from "@/components/BufferPolyfill";
import AppToaster from "@/components/Toaster";
import Dashboard from "@/components/Dashboard";

export default function DashboardPage() {
  return (
    <WalletProviders>
      <BufferPolyfill />
      <AppToaster />
      <Dashboard />
    </WalletProviders>
  );
}
