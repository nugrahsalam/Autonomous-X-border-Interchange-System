import React, { useState, useEffect } from "react";
import {
  useGetAxisStatus,
  useGetAxisBalance,
  useGetAxisTransactions,
  getGetAxisStatusQueryKey,
  getGetAxisBalanceQueryKey,
  getGetAxisTransactionsQueryKey,
} from "@workspace/api-client-react";
import type { TransactionRecord } from "@workspace/api-client-react";
import { Copy, Activity, Clock, CheckCircle2, ArrowRightLeft, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { motion, AnimatePresence } from "framer-motion";

export default function NodePane() {
  const { data: status, isLoading: isStatusLoading } = useGetAxisStatus({
    query: { refetchInterval: 5000, queryKey: getGetAxisStatusQueryKey() },
  });

  const { data: balance, isLoading: isBalanceLoading } = useGetAxisBalance({
    query: { refetchInterval: 5000, queryKey: getGetAxisBalanceQueryKey() },
  });

  const { data: transactionsData, isLoading: isTransactionsLoading } = useGetAxisTransactions(
    { limit: 5 },
    { query: { refetchInterval: 5000, queryKey: getGetAxisTransactionsQueryKey({ limit: 5 }) } }
  );

  const [newTxIds, setNewTxIds] = useState<Set<string>>(new Set());
  const [prevIds, setPrevIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!transactionsData?.transactions) return undefined;
    const currentIds = new Set(transactionsData.transactions.map((t: TransactionRecord) => t.id));
    const fresh = new Set<string>();
    currentIds.forEach((id) => {
      if (!prevIds.has(id)) fresh.add(id);
    });
    setPrevIds(currentIds);
    if (fresh.size > 0) {
      setNewTxIds(fresh);
      const timer = setTimeout(() => setNewTxIds(new Set()), 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [transactionsData]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Address copied", { description: "Copied to clipboard." });
  };

  const truncateHash = (hash: string) => {
    if (!hash) return "";
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  };

  const assetLabel = (asset: string) =>
    asset === "native" || asset === "XLM" ? "XLM" : "USDC";

  const totalVolume = transactionsData?.transactions
    ?.filter((t: TransactionRecord) => t.status === "success")
    ?.reduce((sum: number, t: TransactionRecord) => sum + parseFloat(t.outputAmount || "0"), 0)
    .toFixed(4) ?? "0.0000";

  return (
    <div className="p-6 flex flex-col gap-5 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">AXIS Node</h1>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-success/10 rounded-full border border-success/20">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="text-success font-mono text-sm font-semibold tracking-wider">ONLINE</span>
        </div>
      </div>

      {isStatusLoading || !status ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Treasury Address
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between bg-black/40 p-3 rounded-md border border-border">
              <span className="font-mono text-sm text-primary-foreground/90 break-all">{status.axisAddress}</span>
              <button
                onClick={() => handleCopy(status.axisAddress)}
                className="p-2 hover:bg-primary/20 rounded-md transition-colors text-primary shrink-0 ml-2"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-5">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Uptime
                </span>
                <span className="font-mono text-sm">{new Date(status.upSince).toLocaleDateString()}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <ArrowRightLeft className="w-3 h-3" /> Revenue
                </span>
                <span className="font-mono text-sm text-success">{status.totalRevenue} XLM</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Success
                </span>
                <span className="font-mono text-sm">{status.successCount} txs</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isBalanceLoading || !balance ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Card className="border-border/50 bg-black/20">
            <CardContent className="pt-5">
              <div className="text-sm text-muted-foreground mb-1">XLM Balance</div>
              <div className="text-3xl font-bold font-mono tracking-tight">
                {parseFloat(balance.axis.xlm).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-black/20">
            <CardContent className="pt-5">
              <div className="text-sm text-muted-foreground mb-1">USDC Balance</div>
              <div className="text-3xl font-bold font-mono tracking-tight text-primary">
                {parseFloat(balance.axis.usdc).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="border-border/30 bg-black/20">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingUp className="w-3.5 h-3.5" />
              <span className="uppercase tracking-widest">Path Stats</span>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground/60">XLM → USDC (Testnet)</span>
          </div>
          <div className="grid grid-cols-3 gap-4 mt-3">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Volume</div>
              <div className="font-mono text-sm text-success mt-0.5">{totalVolume} USDC</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Service Fee</div>
              <div className="font-mono text-sm mt-0.5">{status?.serviceFee ?? "—"} XLM</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Network</div>
              <div className="font-mono text-sm mt-0.5">{status?.network ?? "testnet"}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
            Recent Transactions
          </h3>
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] font-mono text-muted-foreground">Live</span>
        </div>

        {isTransactionsLoading || !transactionsData ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : transactionsData.transactions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center border border-dashed border-border rounded-lg bg-black/10">
            <p className="text-muted-foreground text-sm">No transactions yet</p>
          </div>
        ) : (
          <div className="space-y-2 overflow-y-auto">
            <AnimatePresence initial={false}>
              {transactionsData.transactions.map((tx: TransactionRecord) => {
                const isNew = newTxIds.has(tx.id);
                return (
                  <motion.a
                    key={tx.id}
                    href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`block p-3 rounded-lg border transition-all group ${
                      isNew
                        ? "border-primary/60 bg-primary/10 shadow-[0_0_12px_rgba(99,102,241,0.25)]"
                        : "border-border/50 bg-card hover:border-primary/50 hover:bg-primary/5"
                    }`}
                    data-testid={`transaction-row-${tx.id}`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        {isNew && <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
                        <span className="font-mono text-xs text-primary group-hover:underline">
                          {truncateHash(tx.hash)}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(tx.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="font-mono text-sm font-medium">
                        {tx.inputAmount}{" "}
                        <span className="text-muted-foreground text-xs">{assetLabel(tx.inputAsset)}</span>
                      </div>
                      <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <div className="font-mono text-sm font-medium">
                        {tx.outputAmount}{" "}
                        <span className="text-muted-foreground text-xs">{assetLabel(tx.outputAsset)}</span>
                      </div>
                      <div className="ml-auto">
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                            tx.status === "success"
                              ? "text-success border-success/40 bg-success/10"
                              : "text-destructive border-destructive/40 bg-destructive/10"
                          }`}
                        >
                          {tx.status === "success" ? "201" : "ERR"}
                        </span>
                      </div>
                    </div>
                  </motion.a>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
