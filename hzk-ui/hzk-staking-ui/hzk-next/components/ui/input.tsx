import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-xl border border-border/50 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-muted-foreground focus-visible:outline-none",
        className
      )}
      {...props}
    />
  );
}
