"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronUp } from "lucide-react";
import React from "react";

export default function PoolDebug({ data }: { data: any }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="w-full flex items-center justify-between">
          <span>Pool debug (serializable):</span>
          <button className="text-muted-foreground" onClick={() => setOpen((o) => !o)} aria-label="Toggle">
            {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </button>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent>
          <pre className="bg-black text-green-400 text-xs p-4 rounded-xl overflow-auto font-mono max-h-72">
            {JSON.stringify(data, null, 2)}
          </pre>
        </CardContent>
      )}
    </Card>
  );
}
