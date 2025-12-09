"use client";

import { Copy, Check } from "lucide-react";
import React from "react";
import { toast } from "sonner";

export function truncateAddress(addr?: string | null) {
  if (!addr) return "";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function AddressText({ value }: { value?: string | null }) {
  const [copied, setCopied] = React.useState(false);
  const full = value || "";
  const short = truncateAddress(full);

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      toast.error("Copy failed");
    }
  }

  return (
    <span className="inline-flex items-center gap-2 font-mono text-sm" title={full}>
      <span className="truncate max-w-[180px]" aria-label={full}>{short}</span>
      <button onClick={copy} className="text-muted-foreground hover:text-white" aria-label="Copy">
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </span>
  );
}
