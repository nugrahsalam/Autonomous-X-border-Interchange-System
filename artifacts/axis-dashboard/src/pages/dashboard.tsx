import React from "react";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import NodePane from "@/components/dashboard/node-pane";
import DemoPane from "@/components/dashboard/demo-pane";
import ApiPane from "@/components/dashboard/api-pane";

interface DashboardProps {
  role?: "axis" | "agent" | "api";
}

export default function Dashboard({ role = "axis" }: DashboardProps) {
  const [, setLocation] = useLocation();

  if (role === "api") {
    return (
      <div className="min-h-[100dvh] w-full bg-background text-foreground flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background/80 backdrop-blur-sm shrink-0">
          <button
            onClick={() => setLocation("/")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-mono"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Home
          </button>
          <div className="w-px h-3.5 bg-border" />
          <span className="text-xs font-mono text-muted-foreground">
            Viewing as <span className="font-bold text-primary">API Reference</span>
          </span>
        </div>
        <div className="flex-1 max-w-3xl w-full mx-auto md:h-[calc(100dvh-37px)] overflow-y-auto">
          <ApiPane />
        </div>
      </div>
    );
  }

  const leftPane = role === "axis" ? <NodePane /> : <DemoPane />;
  const rightPane = role === "axis" ? <DemoPane /> : <NodePane />;

  const roleLabel = role === "axis" ? "AXIS Node" : "Demo Agent";
  const roleColor = role === "axis" ? "text-primary" : "text-success";

  return (
    <div className="min-h-[100dvh] w-full bg-background text-foreground flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background/80 backdrop-blur-sm shrink-0">
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-mono"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Home
        </button>
        <div className="w-px h-3.5 bg-border" />
        <span className="text-xs font-mono text-muted-foreground">
          Viewing as <span className={`font-bold ${roleColor}`}>{roleLabel}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setLocation(role === "axis" ? "/agent" : "/axis")}
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground border border-border/50 px-2 py-0.5 rounded transition-colors hover:border-border"
          >
            Switch to {role === "axis" ? "Demo Agent" : "AXIS Node"} view →
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        <div className="flex-1 border-r border-border md:h-[calc(100dvh-37px)] overflow-y-auto">
          {leftPane}
        </div>
        <div className="flex-1 md:h-[calc(100dvh-37px)] overflow-y-auto bg-card">
          {rightPane}
        </div>
      </div>
    </div>
  );
}
