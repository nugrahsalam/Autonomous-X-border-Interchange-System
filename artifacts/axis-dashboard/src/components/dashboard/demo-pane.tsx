import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  useGetAxisBalance,
  useAxisDemoTrigger,
  getGetAxisBalanceQueryKey,
  getGetAxisTransactionsQueryKey,
} from "@workspace/api-client-react";
import type { DemoStep, DemoTriggerResponse, AssetBalance, BrainDecision } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Terminal, Play, Wallet, Code2, Link as LinkIcon,
  Loader2, ArrowRight, Brain, Shield, AlertTriangle, TrendingUp, ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AnimatePresence, motion } from "framer-motion";

const DISPLAY_STEPS = ["SCAN", "TRUST", "NEGOTIATE", "THINK", "402", "SWAP", "DONE"] as const;
type DisplayStep = (typeof DISPLAY_STEPS)[number];

const DISPLAY_STEP_META: Record<DisplayStep, { label: string; detail: string; httpStatus: string }> = {
  SCAN:      { label: "SCAN",      detail: "Checking agent balance...",          httpStatus: "200" },
  TRUST:     { label: "TRUST",     detail: "Trustline negotiation...",           httpStatus: "TXN" },
  NEGOTIATE: { label: "NEGOT.",    detail: "Agent-to-agent negotiation...",      httpStatus: "A2A" },
  THINK:     { label: "THINK",     detail: "AI Brain analyzing...",              httpStatus: "AI"  },
  "402":     { label: "402",       detail: "x402 Payment Required...",           httpStatus: "402" },
  SWAP:      { label: "SWAP",      detail: "Executing PathPayment...",           httpStatus: "201" },
  DONE:      { label: "DONE",      detail: "Conversion complete",                httpStatus: "200" },
};

const BACKEND_TO_DISPLAY: Record<string, DisplayStep> = {
  BALANCE:   "SCAN",
  TRUSTLINE: "TRUST",
  NEGOTIATE: "NEGOTIATE",
  THINK:     "THINK",
  QUOTE:     "THINK",
  "402":     "402",
  PAYMENT:   "402",
  SWAP:      "SWAP",
  DONE:      "DONE",
};

const STEP_DELAYS = [0, 2000, 5000, 8000, 12000, 16500, 21500];

type StepStatus = "idle" | "running" | "success" | "failed";

interface SimStep {
  key: DisplayStep;
  status: StepStatus;
  detail: string;
}

interface LogEntry {
  ts: string;
  step: string;
  httpStatus: string;
  detail: string;
  status: string;
  isBrain?: boolean;
  isTrust?: boolean;
  isNegotiate?: boolean;
}

const USDC_DEFAULT = "USDC";
const XLM_DEFAULT = "XLM";

function RiskBadge({ level }: { level: string }) {
  const map: Record<string, { color: string; icon: React.ReactNode }> = {
    low:    { color: "text-success border-success/40 bg-success/10",    icon: <Shield className="w-3 h-3" /> },
    medium: { color: "text-warning border-warning/40 bg-warning/10",    icon: <AlertTriangle className="w-3 h-3" /> },
    high:   { color: "text-destructive border-destructive/40 bg-destructive/10", icon: <AlertTriangle className="w-3 h-3" /> },
  };
  const cfg = map[level] ?? map["low"];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${cfg.color}`}>
      {cfg.icon} {level.toUpperCase()}
    </span>
  );
}

export default function DemoPane() {
  const [destAmount, setDestAmount] = useState("0.5");
  const [srcAsset, setSrcAsset] = useState(XLM_DEFAULT);
  const [destAsset, setDestAsset] = useState(USDC_DEFAULT);
  const [isTriggering, setIsTriggering] = useState(false);
  const [demoResult, setDemoResult] = useState<DemoTriggerResponse | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [simSteps, setSimSteps] = useState<SimStep[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const simTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const queryClient = useQueryClient();

  const { data: balance, isLoading: isBalanceLoading } = useGetAxisBalance({
    query: { refetchInterval: 5000, queryKey: getGetAxisBalanceQueryKey() },
  });

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logEntries]);

  const clearSimTimers = () => {
    simTimersRef.current.forEach(clearTimeout);
    simTimersRef.current = [];
  };

  const startProgressiveSimulation = () => {
    clearSimTimers();
    setSimSteps(
      DISPLAY_STEPS.map((key) => ({
        key,
        status: "idle",
        detail: DISPLAY_STEP_META[key].detail,
      }))
    );
    setLogEntries([]);
    setActiveIdx(-1);

    DISPLAY_STEPS.forEach((key, idx) => {
      const t = setTimeout(() => {
        setActiveIdx(idx);
        setSimSteps((prev) =>
          prev.map((s, i) => {
            if (i < idx) return { ...s, status: "success" };
            if (i === idx) return { ...s, status: "running" };
            return s;
          })
        );
        const isBrain = key === "THINK";
        setLogEntries((prev) => [
          ...prev,
          {
            ts: new Date().toLocaleTimeString(),
            step: DISPLAY_STEP_META[key].label,
            httpStatus: DISPLAY_STEP_META[key].httpStatus,
            detail: isBrain ? "Consulting AXIS Brain (Claude)..." : DISPLAY_STEP_META[key].detail,
            status: "running",
            isBrain,
          },
        ]);
      }, STEP_DELAYS[idx]);
      simTimersRef.current.push(t);
    });
  };

  const finalizeWithRealData = (data: DemoTriggerResponse) => {
    clearSimTimers();
    setActiveIdx(-1);

    const stepMap = new Map<string, DemoStep>(
      (data.steps ?? []).map((s: DemoStep) => [s.step, s])
    );

    const finalSteps: SimStep[] = DISPLAY_STEPS.map((key) => {
      const backendKeys = Object.entries(BACKEND_TO_DISPLAY)
        .filter(([, v]) => v === key)
        .map(([k]) => k);
      const anyFailed = backendKeys.some((bk) => stepMap.get(bk)?.status === "failed");
      const anySuccess = backendKeys.some((bk) => stepMap.get(bk)?.status === "success");
      const detail =
        backendKeys.map((bk) => stepMap.get(bk)?.detail).filter(Boolean).join(" · ") ||
        DISPLAY_STEP_META[key].detail;

      return {
        key,
        status: anyFailed ? "failed" : anySuccess || data.success ? "success" : "idle",
        detail: key === "THINK" && data.brainDecision ? data.brainDecision.summary : detail,
      };
    });
    setSimSteps(finalSteps);

    const logLines: LogEntry[] = [];
    for (const s of data.steps ?? []) {
      const isBrain = s.step === "THINK";
      const isTrust = s.step === "TRUSTLINE";
      const isNegotiate = s.step === "NEGOTIATE";

      if (isBrain && s.detail) {
        const lines = s.detail.split("\n").filter(Boolean);
        for (const line of lines) {
          logLines.push({
            ts: new Date().toLocaleTimeString(),
            step: "THINK",
            status: s.status,
            detail: line,
            httpStatus: "AI",
            isBrain: true,
          });
        }
      } else if (isTrust && s.detail) {
        const lines = s.detail.split("\n").filter(Boolean);
        for (const line of lines) {
          logLines.push({
            ts: new Date().toLocaleTimeString(),
            step: "TRUSTLINE",
            status: s.status,
            detail: line,
            httpStatus: "TXN",
            isTrust: true,
          });
        }
      } else if (isNegotiate && s.detail) {
        const lines = s.detail.split("\n").filter(Boolean);
        for (const line of lines) {
          logLines.push({
            ts: new Date().toLocaleTimeString(),
            step: "NEGOTIATE",
            status: s.status,
            detail: line,
            httpStatus: "A2A",
            isNegotiate: true,
          });
        }
      } else {
        logLines.push({
          ts: new Date().toLocaleTimeString(),
          step: s.step,
          status: s.status,
          detail: s.detail ?? s.status,
          httpStatus: DISPLAY_STEP_META[BACKEND_TO_DISPLAY[s.step] ?? "SCAN"]?.httpStatus ?? "—",
          isBrain: false,
        });
      }
    }
    setLogEntries(logLines);
  };

  useEffect(() => {
    return () => clearSimTimers();
  }, []);

  const triggerDemo = useAxisDemoTrigger({
    mutation: {
      onMutate: () => {
        setIsTriggering(true);
        setDemoResult(null);
        startProgressiveSimulation();
      },
      onSuccess: (data: DemoTriggerResponse) => {
        setIsTriggering(false);
        setDemoResult(data);
        finalizeWithRealData(data);

        queryClient.invalidateQueries({ queryKey: getGetAxisBalanceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAxisTransactionsQueryKey() });

        if (data.success && data.result) {
          toast.success("Conversion Successful", {
            description: `Received ${data.result.outputAmount} ${data.result.outputAsset} · AI fee: ${data.brainDecision?.dynamicFee ?? data.result.fee} XLM`,
            action: {
              label: "Explorer",
              onClick: () => window.open(data.result!.explorerUrl, "_blank"),
            },
            duration: 8000,
          });
        } else if ((data as { cancelled?: boolean }).cancelled) {
          toast.warning("Swap Cancelled by Demo Agent", {
            description: "Demo Agent rejected the alternative asset — mandate requires the original asset.",
            duration: 10000,
          });
        } else {
          toast.error("Conversion Failed", {
            description: data.error ?? "An unknown error occurred",
          });
        }
      },
      onError: (error: Error) => {
        setIsTriggering(false);
        clearSimTimers();
        setSimSteps([]);
        toast.error("Error", { description: error.message ?? "Failed to trigger conversion" });
      },
    },
  });

  const handleTrigger = () => {
    const amt = parseFloat(destAmount);
    if (!destAmount || isNaN(amt) || amt <= 0) {
      toast.error("Invalid amount", { description: "Please enter a valid amount." });
      return;
    }
    if (!destAsset.trim()) {
      toast.error("Missing destination asset", { description: "Enter an asset code (e.g. USDC, AQUA, or CODE:ISSUER)." });
      return;
    }
    triggerDemo.mutate({
      data: {
        destAmount,
        destAsset: destAsset.trim() || undefined,
        srcAsset: srcAsset.trim() || undefined,
      },
    });
  };

  const getStepColor = (s: SimStep, idx: number) => {
    if (s.status === "running") {
      if (s.key === "THINK")
        return "bg-warning/20 border-warning text-warning shadow-[0_0_15px_rgba(245,158,11,0.4)]";
      if (s.key === "TRUST")
        return "bg-sky-500/20 border-sky-400 text-sky-300 shadow-[0_0_15px_rgba(56,189,248,0.4)]";
      if (s.key === "NEGOTIATE")
        return "bg-orange-500/20 border-orange-400 text-orange-300 shadow-[0_0_15px_rgba(249,115,22,0.5)]";
      return "bg-primary border-primary text-primary-foreground shadow-[0_0_15px_rgba(99,102,241,0.5)]";
    }
    if (s.status === "success" || idx < activeIdx) return "bg-success border-success text-success-foreground";
    if (s.status === "failed") return "bg-destructive border-destructive text-destructive-foreground";
    return "bg-card border-border text-muted-foreground";
  };

  const getStepTextColor = (s: SimStep, idx: number) => {
    if (s.status === "running") {
      if (s.key === "THINK") return "text-warning";
      if (s.key === "TRUST") return "text-sky-400";
      if (s.key === "NEGOTIATE") return "text-orange-400";
      return "text-primary";
    }
    if (s.status === "success" || idx < activeIdx) return "text-success";
    if (s.status === "failed") return "text-destructive";
    return "text-muted-foreground";
  };

  const demoBalances: AssetBalance[] = balance?.demoAgent?.balances ?? [
    { asset: "XLM", balance: balance?.demoAgent?.xlm ?? "0" },
    { asset: "USDC", balance: balance?.demoAgent?.usdc ?? "0", issuer: undefined },
  ];

  const displayedSrc = srcAsset.trim().toUpperCase().replace(/:.+/, "") || "XLM";
  const displayedDest = destAsset.trim().toUpperCase().replace(/:.+/, "") || "USDC";
  const brain: BrainDecision | undefined = demoResult?.brainDecision;

  return (
    <div className="p-5 flex flex-col gap-4 h-full bg-card">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg text-primary">
          <Terminal className="w-5 h-5" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Demo Terminal</h2>
        {brain && (
          <div className="ml-auto flex items-center gap-1.5 text-xs font-mono text-warning">
            <Brain className="w-3.5 h-3.5" />
            AI Brain Active
          </div>
        )}
      </div>

      {isBalanceLoading || !balance ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <Card className="border-border bg-black/40">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Wallet className="w-3.5 h-3.5" />
              Demo Agent Wallet
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-1">
            <div className="font-mono text-[10px] text-muted-foreground mb-3 truncate bg-black/50 p-1.5 rounded border border-border">
              {balance.demoAgent.address}
            </div>
            <div className="flex flex-wrap gap-4">
              {demoBalances.map((b) => (
                <div key={`${b.asset}-${b.issuer ?? "native"}`} className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted-foreground">{b.asset}</span>
                  <span className={`font-mono font-medium text-sm ${b.asset === "XLM" ? "text-foreground" : "text-primary"}`}>
                    {parseFloat(b.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="bg-background p-3 rounded-lg border border-border shadow-sm space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">From Asset</label>
            <Input
              value={srcAsset}
              onChange={(e) => setSrcAsset(e.target.value)}
              placeholder="XLM"
              className="font-mono text-sm h-8 bg-black/50 border-border/50 focus-visible:ring-primary"
              disabled={isTriggering}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">To Asset</label>
            <Input
              value={destAsset}
              onChange={(e) => setDestAsset(e.target.value)}
              placeholder="USDC or CODE:ISSUER"
              className="font-mono text-sm h-8 bg-black/50 border-border/50 focus-visible:ring-primary"
              disabled={isTriggering}
            />
            {destAsset.trim() && !["XLM", "USDC", "NATIVE", ""].includes(destAsset.trim().toUpperCase()) && (
              <p className="text-[9px] text-success/70 leading-tight">Custom asset — AXIS will discover issuer via Stellar ✓</p>
            )}
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Receive Amount</label>
            <div className="relative">
              <Input
                type="number"
                value={destAmount}
                onChange={(e) => setDestAmount(e.target.value)}
                className="font-mono text-lg h-11 bg-black/50 border-border/50 pl-4 pr-20 focus-visible:ring-primary"
                data-testid="input-usdc-amount"
                disabled={isTriggering}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs">{displayedDest}</span>
            </div>
          </div>
          <Button
            size="lg"
            onClick={handleTrigger}
            disabled={isTriggering}
            className="h-11 px-5 font-bold tracking-wide bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_20px_rgba(99,102,241,0.3)] transition-all"
            data-testid="button-trigger-demo"
          >
            {isTriggering ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> EXECUTING...</>
            ) : (
              <><Play className="w-4 h-4 mr-2" /> TRIGGER</>
            )}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground uppercase tracking-widest">
          <span>Protocol Execution</span>
          {demoResult?.rawRequest && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-6 text-[10px] border-border/50 bg-black/30 hover:bg-black/50" data-testid="button-view-raw-request">
                  <Code2 className="w-3 h-3 mr-1" /> x402 Request
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px] bg-card border-border">
                <DialogHeader>
                  <DialogTitle className="font-mono text-sm">x402 Protocol Request</DialogTitle>
                </DialogHeader>
                <div className="bg-black/80 p-4 rounded-md overflow-x-auto border border-border mt-2">
                  <pre className="font-mono text-xs text-primary-foreground/80">{JSON.stringify(demoResult.rawRequest, null, 2)}</pre>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="relative">
          <div className="absolute top-4 left-4 right-4 h-0.5 bg-border z-0" />
          <div className="relative z-10 flex justify-between">
            {(simSteps.length > 0 ? simSteps : DISPLAY_STEPS.map((k) => ({ key: k, status: "idle" as const, detail: "" }))).map(
              (s, idx) => (
                <div key={s.key} className="flex flex-col items-center gap-2 w-[15%]" data-testid={`step-indicator-${s.key}`}>
                  <motion.div
                    animate={s.status === "running" ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                    transition={{
                      duration: s.key === "THINK" ? 0.8 : s.key === "TRUST" ? 1.2 : 1,
                      repeat: s.status === "running" ? Infinity : 0,
                    }}
                    className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${getStepColor(s, idx)}`}
                  >
                    {s.key === "THINK" && s.status === "running" ? (
                      <Brain className="w-3 h-3 animate-pulse" />
                    ) : s.key === "TRUST" && s.status === "running" ? (
                      <ShieldCheck className="w-3 h-3 animate-pulse" />
                    ) : (
                      <span className="text-[9px] font-bold font-mono">{idx + 1}</span>
                    )}
                  </motion.div>
                  <div className="text-center">
                    <div className={`text-[8px] font-bold tracking-wider font-mono ${getStepTextColor(s, idx)}`}>
                      {s.key}
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        {(() => {
          const negotiateStep = demoResult?.steps?.find((s: DemoStep) => s.step === "NEGOTIATE");
          if (!negotiateStep) return null;
          const lines = (negotiateStep.detail ?? "").split("\n").filter(Boolean);
          const axisProposal = lines.find((l) => l.startsWith("[AXIS →"));
          const agentResponse = lines.find((l) => l.startsWith("[Demo Agent →"));
          const agentMandate = lines.find((l) => l.startsWith("[Demo Agent mandate]"));
          const poolScanHeader = lines.find((l) => l.startsWith("[AXIS Scanning]"));
          const poolLines = lines.filter((l) => l.startsWith("[Pool Found]") || l.startsWith("[Pool]"));
          const accepted = negotiateStep.status.toLowerCase().includes("accepted");
          return (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-lg border p-3 space-y-2 ${accepted ? "border-success/30 bg-success/5" : "border-orange-500/30 bg-orange-500/5"}`}
            >
              <div className="flex items-center justify-between">
                <div className={`flex items-center gap-2 text-xs font-mono font-bold ${accepted ? "text-success" : "text-orange-400"}`}>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  AGENT NEGOTIATION {accepted ? "— ACCEPTED" : "— REJECTED"}
                </div>
                <span className={`text-[9px] font-mono border rounded px-1.5 py-0.5 ${accepted ? "text-success border-success/40" : "text-orange-400 border-orange-400/40"}`}>
                  A2A
                </span>
              </div>
              {poolScanHeader && (
                <div className="bg-teal-950/40 border border-teal-500/20 rounded px-2 py-1.5 space-y-0.5">
                  <span className="text-[9px] text-teal-400 font-bold font-mono block mb-1">AMM POOL SCAN</span>
                  <p className="text-[10px] text-teal-300/80 font-mono">{poolScanHeader.replace("[AXIS Scanning] ", "")}</p>
                  {poolLines.map((l, i) => (
                    <p key={i} className="text-[10px] text-teal-200/70 font-mono pl-2 border-l border-teal-500/30">
                      {l.replace("[Pool Found] ", "")}
                    </p>
                  ))}
                </div>
              )}
              {agentMandate && (
                <p className="text-[10px] text-muted-foreground font-mono italic">
                  {agentMandate.replace("[Demo Agent mandate] ", "")}
                </p>
              )}
              {axisProposal && (
                <div className="bg-black/30 rounded px-2 py-1.5">
                  <span className="text-[9px] text-primary font-bold block mb-0.5">AXIS</span>
                  <p className="text-[10px] text-foreground/80 font-mono">{axisProposal.replace("[AXIS → Demo Agent] ", "")}</p>
                </div>
              )}
              {agentResponse && (
                <div className={`rounded px-2 py-1.5 ${accepted ? "bg-success/10" : "bg-orange-500/10"}`}>
                  <span className={`text-[9px] font-bold block mb-0.5 ${accepted ? "text-success" : "text-orange-400"}`}>DEMO AGENT</span>
                  <p className={`text-[10px] font-mono font-semibold ${accepted ? "text-success/90" : "text-orange-300"}`}>{agentResponse.replace("[Demo Agent → AXIS] ", "")}</p>
                </div>
              )}
            </motion.div>
          );
        })()}

        {brain && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono text-warning font-bold">
                <Brain className="w-3.5 h-3.5" />
                AXIS BRAIN DECISION
              </div>
              <RiskBadge level={brain.riskLevel} />
            </div>
            <p className="text-xs text-foreground/80 font-mono">{brain.summary}</p>
            <div className="grid grid-cols-2 gap-3 text-[10px] font-mono">
              <div className="space-y-0.5">
                <span className="text-muted-foreground">Dynamic Fee</span>
                <div className="text-warning font-bold flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  {brain.dynamicFee} XLM
                </div>
                <div className="text-muted-foreground/60 text-[9px]">{brain.feeReason}</div>
              </div>
              <div className="space-y-0.5">
                <span className="text-muted-foreground">Path</span>
                <div className="text-foreground/80 flex items-center gap-1">
                  <ArrowRight className="w-3 h-3" />
                  {brain.pathRecommendation}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        <div className="h-24 bg-black/40 rounded-lg border border-border flex items-center justify-center p-4 relative overflow-hidden">
          <div className="flex items-center w-full max-w-sm justify-between relative z-10">
            <div className="flex flex-col items-center gap-1">
              <div className="w-10 h-10 rounded-lg bg-card border border-border flex items-center justify-center text-[10px] font-mono">Agent</div>
              <span className="text-[9px] text-muted-foreground font-mono">{displayedSrc}</span>
            </div>
            <div className="flex-1 px-2 relative h-px flex items-center">
              <div className="absolute inset-0 h-px border-t border-dashed border-muted-foreground" />
              {isTriggering && (
                <motion.div
                  className="absolute h-1 w-8 bg-primary rounded-full shadow-[0_0_8px_rgba(99,102,241,0.8)]"
                  animate={{ left: ["0%", "100%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                />
              )}
            </div>
            <div className={`w-14 h-14 rounded-xl border-2 flex items-center justify-center font-bold tracking-widest bg-black transition-colors text-xs ${
              isTriggering ? "border-primary text-primary shadow-[0_0_20px_rgba(99,102,241,0.4)]" : "border-border text-muted-foreground"
            }`}>
              AXIS
            </div>
            <div className="flex-1 px-2 relative h-px flex items-center">
              <div className="absolute inset-0 h-px border-t border-dashed border-muted-foreground" />
              {isTriggering && (
                <motion.div
                  className="absolute h-1 w-8 bg-success rounded-full shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                  animate={{ left: ["0%", "100%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear", delay: 0.75 }}
                />
              )}
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-10 h-10 rounded-lg bg-card border border-border flex items-center justify-center text-[10px] font-mono">Agent</div>
              <span className="text-[9px] text-primary font-mono font-bold">{displayedDest}</span>
            </div>
          </div>
        </div>

        <div
          ref={logRef}
          className="bg-black/60 border border-border rounded-lg p-3 h-44 overflow-y-auto font-mono text-xs space-y-1.5"
        >
          <AnimatePresence>
            {logEntries.length === 0 && !isTriggering ? (
              <div className="text-muted-foreground/50 italic">System ready. Waiting for trigger...</div>
            ) : null}
            {logEntries.map((entry, i) => (
              <motion.div
                key={`${entry.step}-${i}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex gap-2 text-muted-foreground"
              >
                <span className="text-muted-foreground/40 shrink-0 text-[10px]">[{entry.ts}]</span>
                {entry.isBrain ? (
                  <>
                    <span className="text-warning font-bold shrink-0 text-[10px]">AI</span>
                    <span className="text-warning/80 truncate">{entry.detail}</span>
                  </>
                ) : entry.isTrust ? (
                  <>
                    <span className="text-sky-400 font-bold shrink-0 text-[10px]">TXN</span>
                    <span className={`truncate ${
                      entry.detail.startsWith("[AXIS →") ? "text-primary/90" :
                      entry.detail.startsWith("[Demo Agent →") ? "text-sky-300/90 font-semibold" :
                      "text-sky-300/80"
                    }`}>{entry.detail}</span>
                  </>
                ) : entry.isNegotiate ? (
                  <>
                    <span className="text-orange-400 font-bold shrink-0 text-[10px]">A2A</span>
                    <span className={`truncate ${
                      entry.detail.startsWith("[AXIS →") ? "text-primary/90" :
                      entry.detail.startsWith("[Demo Agent →") ? "text-orange-300 font-semibold" :
                      entry.detail.startsWith("[Demo Agent thinking]") ? "text-yellow-400/80 italic" :
                      entry.detail.startsWith("[Demo Agent mandate]") ? "text-orange-400/90" :
                      entry.detail.startsWith("[AXIS]") ? "text-muted-foreground/70" :
                      "text-orange-300/80"
                    }`}>{entry.detail}</span>
                  </>
                ) : (
                  <>
                    <span className={`font-bold shrink-0 w-8 ${
                      entry.httpStatus === "402" ? "text-warning"
                        : entry.httpStatus === "201" ? "text-success"
                        : entry.status === "failed" ? "text-destructive"
                        : "text-primary"
                    }`}>{entry.httpStatus}</span>
                    <span className="text-muted-foreground shrink-0 w-16 text-[10px]">{entry.step}</span>
                    <span className="text-foreground/80 truncate">{entry.detail}</span>
                  </>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {demoResult?.result && (
          <div className="flex items-center justify-between text-xs font-mono bg-success/10 border border-success/20 rounded-lg px-3 py-2">
            <span className="text-success font-semibold flex items-center gap-1.5">
              <ArrowRight className="w-3 h-3" />
              {demoResult.result.inputAsset} → {demoResult.result.outputAsset}
            </span>
            <span className="text-foreground/60 text-[10px] hidden sm:block">{demoResult.result.route}</span>
            <a
              href={demoResult.result.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline flex items-center gap-1"
            >
              <LinkIcon className="w-3 h-3" /> Explorer
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
