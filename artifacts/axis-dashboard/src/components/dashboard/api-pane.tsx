import React, { useState, useCallback } from "react";
import { toast } from "sonner";
import { useGetAxisStatus } from "@workspace/api-client-react";
import { getGetAxisStatusQueryKey } from "@workspace/api-client-react";
import {
  Copy, CheckCircle2, Activity, Code2, Zap, Globe, ChevronDown,
  ChevronRight, Terminal, BookOpen, ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE = `${window.location.origin}/api`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
      title="Copy"
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  return (
    <div className="relative group">
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border border-border/50 rounded-t-lg">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{language}</span>
        <CopyButton text={code} />
      </div>
      <pre className="bg-black/40 border border-t-0 border-border/50 rounded-b-lg p-4 overflow-x-auto text-xs font-mono leading-relaxed text-foreground/90">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function EndpointCard({
  method,
  path,
  description,
  badge,
  badgeColor = "text-primary",
  children,
}: {
  method: "GET" | "POST";
  path: string;
  description: string;
  badge?: string;
  badgeColor?: string;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const methodColor = method === "GET" ? "text-success" : "text-warning";

  return (
    <div className="border border-border/60 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-white/5 transition-colors text-left"
      >
        <span className={`font-mono text-xs font-bold ${methodColor} w-10 shrink-0`}>{method}</span>
        <span className="font-mono text-sm text-foreground/90 flex-1">{path}</span>
        {badge && (
          <span className={`text-[10px] font-mono ${badgeColor} border border-current/30 px-2 py-0.5 rounded-full`}>
            {badge}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-2 border-t border-border/40 bg-black/20 flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{description}</p>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const STATUS_CURL = `curl -s ${API_BASE}/axis/status`;

const QUOTE_CURL = `# Step 1: Get a price quote — how much your agent needs to send
curl -s "${API_BASE}/axis/quote?srcAsset=XLM&destAsset=USDC&destAmount=1&agentAddress=<YOUR_STELLAR_ADDRESS>"

# Returns:
# {
#   "success": true,
#   "quote": {
#     "sourceAmount": "2.5000000",   // XLM you need to fund the swap
#     "fee": "0.0010000",            // AXIS service fee (XLM)
#     "totalRequired": "2.5010000",  // Total XLM to send via MPP = source + fee
#     "route": "XLM → USDC",
#     "validUntil": "2026-04-11T18:10:00.000Z",
#     "instructions": "Send totalRequired XLM via MPP to /axis/convert..."
#   }
# }`;

const CONVERT_CURL = `# Step 2: Execute swap — agent sends totalRequired XLM via MPP
# AXIS uses sourceAmount for PathPayment → delivers destAsset to agentAddress
# AXIS keeps fee as revenue

curl -s -X POST ${API_BASE}/axis/convert \\
  -H "Content-Type: application/json" \\
  -H "X-Axis-Fee: 2.5010000" \\
  -d '{"destAmount":"1","destAsset":"USDC","srcAsset":"XLM","agentAddress":"<YOUR_STELLAR_ADDRESS>"}'

# Note: /axis/convert uses MPP (Machine Payments Protocol).
# A 402 challenge is returned first — use mppx to handle automatically.`;

const MPPX_EXAMPLE = `import { Mppx } from "mppx/client";
import { stellar } from "@stellar/mpp/charge/client";
import { Keypair } from "@stellar/stellar-sdk";

const AXIS_API = "${API_BASE}";

const agentKeypair = Keypair.fromSecret("S...");  // your agent's secret key

// Step 1: Get quote from AXIS
const quoteRes = await fetch(
  \`\${AXIS_API}/axis/quote?srcAsset=XLM&destAsset=USDC&destAmount=1\` +
  \`&agentAddress=\${agentKeypair.publicKey()}\`
);
const { quote } = await quoteRes.json();
// quote.totalRequired = sourceAmount + fee (e.g. "2.5010000")

// Step 2: Set up MPP client — agent funds the swap via Soroban SAC
const mppxClient = Mppx.create({
  methods: [
    stellar.charge({
      keypair: agentKeypair,
      mode: "push",           // agent sends totalRequired XLM first, then retries
      onProgress: (event) => {
        if (event.type === "challenge") {
          // AXIS issued 402: breakdown = sourceAmount + fee
          console.log("AXIS requires:", event.amount, "XLM");
        } else if (event.type === "paid") {
          // Agent funds received by AXIS treasury
          console.log("Funds sent, tx:", event.hash);
        }
      },
    }),
  ],
});

// Step 3: Execute — handles 402 → send XLM → retry automatically
const response = await mppxClient.fetch(\`\${AXIS_API}/axis/convert\`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Axis-Fee": quote.totalRequired,  // total amount AXIS will charge via MPP
  },
  body: JSON.stringify({
    destAmount: "1",
    destAsset: "USDC",
    srcAsset: "XLM",
    agentAddress: agentKeypair.publicKey(),  // AXIS sends destAsset here
  }),
});

const result = await response.json();
// result.result.sourceAmount  = XLM used for PathPayment
// result.result.fee           = AXIS service fee (kept as revenue)
// result.result.totalPaid     = total XLM agent paid
// result.result.outputAmount  = USDC delivered to agentAddress
// result.result.swapHash      = Stellar transaction hash`;

const TRIGGER_CURL = `# High-level demo trigger (full 8-step autonomous flow):
curl -s -X POST ${API_BASE}/axis/demo/trigger \\
  -H "Content-Type: application/json" \\
  -d '{
    "destAsset": "USDC",
    "destAmount": "1",
    "srcAsset": "XLM"
  }'

# Returns: steps[], brainDecision, result
# Steps: BALANCE → SCAN → THINK → QUOTE → 402 → PAYMENT → SWAP → DONE
# result.sourceAmount = XLM used for swap
# result.fee         = AXIS service fee
# result.totalPaid   = total XLM agent paid`;

export default function ApiPane() {
  const { data: status, isLoading } = useGetAxisStatus({
    query: { refetchInterval: 10000, queryKey: getGetAxisStatusQueryKey() },
  });

  const isOnline = status?.status === "online";

  return (
    <div className="p-6 flex flex-col gap-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
            <BookOpen className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AXIS API</h1>
            <p className="text-xs font-mono text-muted-foreground mt-0.5">
              Agent-to-Agent Liquidity · Stellar Testnet
            </p>
          </div>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-mono font-semibold ${
          isLoading ? "bg-muted/20 border-border text-muted-foreground" :
          isOnline ? "bg-success/10 border-success/20 text-success" :
          "bg-destructive/10 border-destructive/20 text-destructive"
        }`}>
          <div className={`w-2 h-2 rounded-full ${isLoading ? "bg-muted-foreground" : isOnline ? "bg-success animate-pulse" : "bg-destructive"}`} />
          {isLoading ? "CHECKING..." : isOnline ? "ONLINE" : "OFFLINE"}
        </div>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <Globe className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground font-mono mb-1">Base URL</p>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-primary break-all">{API_BASE}</code>
                <CopyButton text={API_BASE} />
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border/40 grid grid-cols-2 gap-3 text-xs font-mono">
            <div>
              <span className="text-muted-foreground">Fee: </span>
              <span className="text-warning">
                {isLoading ? "..." : (status?.serviceFee ?? "0.001")} XLM
              </span>
              <span className="text-muted-foreground"> (dynamic, AI-set)</span>
            </div>
            <div>
              <span className="text-muted-foreground">Protocol: </span>
              <span className="text-primary">MPP Stellar Charge</span>
            </div>
            <div>
              <span className="text-muted-foreground">Network: </span>
              <span className="text-foreground">Stellar Testnet</span>
            </div>
            <div>
              <span className="text-muted-foreground">Payment: </span>
              <span className="text-foreground">Soroban SAC XLM</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Endpoints</h2>
        </div>
        <div className="flex flex-col gap-2">

          <EndpointCard
            method="GET"
            path="/axis/status"
            description="Check AXIS node health, treasury address, current fee, and supported asset pairs."
            badge="No auth"
            badgeColor="text-success"
          >
            <CodeBlock code={STATUS_CURL} language="curl" />
            <div className="text-xs font-mono text-muted-foreground mt-1">
              Returns: <code className="text-foreground/80">{"{ status, axisAddress, serviceFee, paymentProtocol }"}</code>
            </div>
          </EndpointCard>

          <EndpointCard
            method="GET"
            path="/axis/balance"
            description="Get current AXIS treasury balance (XLM + USDC) and all token holdings."
            badge="No auth"
            badgeColor="text-success"
          >
            <CodeBlock code={`curl -s ${API_BASE}/axis/balance`} language="curl" />
          </EndpointCard>

          <EndpointCard
            method="GET"
            path="/axis/quote"
            description="Get a swap price quote. Returns the exact sourceAmount your agent needs to fund, plus the AXIS fee — combine them as totalRequired to pass to /axis/convert."
            badge="No auth"
            badgeColor="text-success"
          >
            <CodeBlock code={QUOTE_CURL} language="curl" />
            <div className="text-xs font-mono text-muted-foreground mt-1">
              Params: <code className="text-foreground/80">srcAsset, destAsset, destAmount, agentAddress</code>
            </div>
          </EndpointCard>

          <EndpointCard
            method="POST"
            path="/axis/convert"
            description="Execute an asset swap. Agent sends totalRequired XLM (source + fee) to AXIS via MPP — AXIS runs PathPayment and delivers destAsset back to agentAddress. Requires agentAddress in body."
            badge="MPP 402"
            badgeColor="text-warning"
          >
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Raw request body</p>
                <CodeBlock
                  language="json"
                  code={`{
  "destAsset": "USDC",        // target asset (code or CODE:ISSUER)
  "destAmount": "1",          // exact amount agent wants to receive
  "srcAsset": "XLM",          // source asset to sell
  "agentAddress": "G...",     // REQUIRED: your Stellar public key
                               // AXIS delivers destAsset here after swap
}`}
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Using mppx (recommended — handles 402 automatically)</p>
                <CodeBlock code={MPPX_EXAMPLE} language="typescript" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Raw curl (manual, shows the 402 flow)</p>
                <CodeBlock code={CONVERT_CURL} language="curl" />
              </div>
            </div>
          </EndpointCard>

          <EndpointCard
            method="POST"
            path="/axis/demo/trigger"
            description="Full autonomous 8-step demo flow: AXIS scans pools, AI brain decides, gets quote, agent sends totalRequired XLM via MPP, then swap executes and tokens arrive. Useful for integration testing."
            badge="Demo"
            badgeColor="text-primary"
          >
            <CodeBlock code={TRIGGER_CURL} language="curl" />
            <div className="text-xs font-mono text-muted-foreground mt-1">
              Returns: <code className="text-foreground/80">{"{ steps[], brainDecision, result: { feeHash, swapHash, outputAmount } }"}</code>
            </div>
          </EndpointCard>

          <EndpointCard
            method="GET"
            path="/axis/transactions"
            description="Retrieve transaction history from the AXIS node (last 50 swaps)."
            badge="No auth"
            badgeColor="text-success"
          >
            <CodeBlock code={`curl -s "${API_BASE}/axis/transactions?limit=10"`} language="curl" />
          </EndpointCard>

        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">MPP Payment Flow</h2>
        </div>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-col gap-2 font-mono text-xs">
              {[
                ["1", "Agent POSTs to /axis/convert", "text-foreground/70"],
                ["2", "AXIS replies 402 + WWW-Authenticate: Payment (Soroban SAC XLM challenge)", "text-warning"],
                ["3", "mppx submits Soroban SAC XLM transfer to AXIS treasury (native XLM, ~0.001 XLM)", "text-primary"],
                ["4", "AXIS verifies payment on-chain via Horizon", "text-success"],
                ["5", "mppx retries with Authorization: Payment credential", "text-foreground/70"],
                ["6", "AXIS executes PathPaymentStrictReceive → sends tokens to agent", "text-success"],
              ].map(([num, text, color]) => (
                <div key={num} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded bg-white/5 border border-border/50 flex items-center justify-center text-muted-foreground shrink-0">
                    {num}
                  </span>
                  <span className={color as string}>{text}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Terminal className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Install</h2>
        </div>
        <CodeBlock
          language="bash"
          code={`# Install MPP client libraries
npm install mppx @stellar/mpp @stellar/stellar-sdk viem`}
        />
      </div>

      <div className="mt-auto pt-4 border-t border-border/30 flex items-center justify-between text-[10px] font-mono text-muted-foreground/50">
        <span>AXIS · Stellar Agents Hackathon · Testnet Only</span>
        <a
          href="https://paymentauth.org"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 hover:text-muted-foreground transition-colors"
        >
          MPP Spec <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}
