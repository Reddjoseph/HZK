import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "secondary" | "outline";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

export function Button({ className, variant = "default", loading, disabled, children, ...props }: ButtonProps) {
  const base = "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none h-11 px-4";
  const variants: Record<Variant, string> = {
    default: "bg-emerald-500 hover:bg-emerald-600 text-white",
    secondary: "bg-amber-500 hover:bg-amber-600 text-white",
    outline: "border border-white/20 bg-transparent hover:bg-white/10 text-white",
  };
  return (
    <button className={cn(base, variants[variant], className)} disabled={disabled || loading} {...props}>
      {loading && <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />}
      {children}
    </button>
  );
}
