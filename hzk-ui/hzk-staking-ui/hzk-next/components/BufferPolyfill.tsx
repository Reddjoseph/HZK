"use client";
import { useEffect } from "react";
import { Buffer } from "buffer";
import process from "process";

export default function BufferPolyfill() {
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).Buffer = (window as any).Buffer || Buffer;
      (globalThis as any).Buffer = (globalThis as any).Buffer || Buffer;
      (window as any).process = (window as any).process || process;
      (globalThis as any).process = (globalThis as any).process || process;
    }
  }, []);
  return null;
}
