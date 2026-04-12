import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";
import type { LiquidityPoolInfo } from "./liquidityPools";

export interface DemoAgentNegotiationCtx {
  originalAsset: string;
  originalAmount: string;
  proposedAlternative: string;
  proposedAmount: string;
  reasonNoLiquidity: string;
  /** AMM pools found for the original asset — enriches the AI negotiation context */
  poolsFound?: LiquidityPoolInfo[];
}

export interface DemoAgentDecision {
  mandate: string;
  reasoning: string[];
  accepted: boolean;
  response: string;
}

const DEMO_AGENT_SYSTEM_PROMPT = `You are Demo Agent — an autonomous AI financial agent operating on Stellar Testnet. You manage a cross-border liquidity position and have strict financial mandates.

Your current mandate: You specifically require YXLM (Yield XLM) — a yield-bearing XLM wrapper that earns automatic staking rewards. You need it because:
- You are providing liquidity to a Stellar AMM pool that requires YXLM
- YXLM earns ~4% APY vs plain XLM
- Your DeFi position needs exact collateral type — substitutes are not acceptable
- USDC, XLM, or other stablecoins do NOT fulfill this requirement

When AXIS (a liquidity provider) proposes an alternative asset because it cannot source your requested asset, evaluate it strictly:
- If the alternative is fundamentally different from your mandate → REJECT firmly
- If the alternative can reasonably serve your purpose → consider accepting with explanation

Be concise, autonomous, and professional. Speak as an AI agent, not a human.`;

export async function consultDemoAgentBrain(ctx: DemoAgentNegotiationCtx): Promise<DemoAgentDecision> {
  const poolSection = ctx.poolsFound && ctx.poolsFound.length > 0
    ? `\nSTELLAR AMM POOL SCAN RESULTS for ${ctx.originalAsset}:\n` +
      ctx.poolsFound.map((p, i) =>
        `  Pool ${i + 1}: ${p.pairLabel} | Reserves: ${p.reserves.map((r) => `${r.amount} ${r.asset}`).join(" + ")} | Fee: ${p.feeBp / 100}%`
      ).join("\n") +
      `\n  Note: These AMM pools hold ${ctx.originalAsset} liquidity but require routing through an intermediate asset.`
    : `\nSTELLAR AMM POOL SCAN: No AMM liquidity pools found for ${ctx.originalAsset} on Stellar Testnet.`;

  const negotiationMessage = `
AXIS LIQUIDITY NODE PROPOSAL:
- You originally requested: ${ctx.originalAmount} ${ctx.originalAsset}
- Reason request cannot be fulfilled via direct DEX path: ${ctx.reasonNoLiquidity}
${poolSection}
- AXIS proposes alternative: ${ctx.proposedAmount} ${ctx.proposedAlternative} instead
  (If pools exist above, AXIS can route through them as an intermediate hop)

Evaluate this proposal against your mandate. Should you accept or reject?`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: DEMO_AGENT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: negotiationMessage }],
      tools: [
        {
          name: "agent_negotiation_decision",
          description: "Demo Agent's decision on AXIS's alternative asset proposal",
          input_schema: {
            type: "object" as const,
            properties: {
              mandate: {
                type: "string",
                description: "Brief statement of why you need the original asset (1 sentence)",
              },
              reasoning: {
                type: "array",
                items: { type: "string" },
                description: "2-4 reasoning steps evaluating the alternative",
              },
              accepted: {
                type: "boolean",
                description: "Whether Demo Agent accepts the proposed alternative",
              },
              response: {
                type: "string",
                description: "Demo Agent's direct response message to AXIS (1-2 sentences, assertive AI agent tone)",
              },
            },
            required: ["mandate", "reasoning", "accepted", "response"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "agent_negotiation_decision" },
    });

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      throw new Error("Demo Agent Brain did not return a decision");
    }

    const decision = toolBlock.input as DemoAgentDecision;
    logger.info({ accepted: decision.accepted, mandate: decision.mandate }, "Demo Agent negotiation decision");
    return decision;
  } catch (err) {
    logger.error({ err }, "Demo Agent Brain error — defaulting to reject");
    return {
      mandate: "Mandate requires YXLM specifically for yield-bearing DeFi position",
      reasoning: [
        "Original request was for YXLM — a yield-bearing asset",
        "Proposed alternative does not match mandate requirements",
        "Cannot substitute — rejecting proposal",
      ],
      accepted: false,
      response: "Mandate requires YXLM specifically. Alternative asset does not fulfill the yield-bearing requirement. Rejecting.",
    };
  }
}

export interface BrainContext {
  srcAsset: string;
  destAsset: string;
  destAmount: string;
  axisXlmBalance: string;
  demoXlmBalance: string;
  demoDestBalance: string;
  estimatedSourceAmount: string;
  pathLabels: string[];
  networkId: string;
}

export interface BrainDecision {
  thinkingLog: string[];
  dynamicFee: string;
  feeReason: string;
  riskLevel: "low" | "medium" | "high";
  approved: boolean;
  summary: string;
  pathRecommendation: string;
}

const AXIS_SYSTEM_PROMPT = `You are AXIS-Brain, the AI financial decision engine for the AXIS Autonomous X-border Interchange System running on Stellar.

Your role is to act as the CFO of the AXIS liquidity node. When a swap request arrives, you must:
1. Analyze market conditions and balances
2. Assess risk (slippage, liquidity, treasury health)
3. Recommend the optimal path
4. Set a dynamic service fee (base: 0.001 XLM, range: 0.0005–0.005 XLM)
5. Approve or reject the transaction

IMPORTANT: This runs on Stellar TESTNET for a hackathon demo. Testnet liquidity is limited. When the swap is small (under 100 XLM equivalent), both parties have healthy balances (over 100 XLM each), and slippage is under 50%, you should APPROVE the transaction. Only reject for genuinely problematic conditions (insufficient balance, extreme slippage >200%, or suspicious activity). Default to approval for valid demo scenarios.

Your thinking must be transparent and audit-ready. Be concise but insightful.`;

export async function consultBrain(ctx: BrainContext): Promise<BrainDecision> {
  const axisXlm = parseFloat(ctx.axisXlmBalance);
  const demoXlm = parseFloat(ctx.demoXlmBalance);
  const estimatedSrc = parseFloat(ctx.estimatedSourceAmount);
  const destAmt = parseFloat(ctx.destAmount);

  const contextMessage = `
SWAP REQUEST:
- From: ${ctx.srcAsset}
- To: ${ctx.destAsset}
- Client wants to receive: ${ctx.destAmount} ${ctx.destAsset}
- Estimated source cost: ${ctx.estimatedSourceAmount} ${ctx.srcAsset}

TREASURY STATUS:
- AXIS Treasury XLM balance: ${ctx.axisXlmBalance} XLM
- Treasury health: ${axisXlm > 1000 ? "HEALTHY" : axisXlm > 100 ? "MODERATE" : "LOW"}
- Post-swap treasury balance: ~${(axisXlm - estimatedSrc).toFixed(4)} XLM

CLIENT STATUS:
- Demo Agent XLM balance: ${ctx.demoXlmBalance} XLM
- Demo Agent ${ctx.destAsset} balance: ${ctx.demoDestBalance}
- Client can pay fee: ${demoXlm > 0.005 ? "YES" : "MARGINAL"}

PATH ANALYSIS:
- Network: ${ctx.networkId}
- Stellar pathfinder suggests: ${ctx.pathLabels.length > 0 ? ctx.pathLabels.join(" → ") : "direct route"}
- Swap amount: ${destAmt} ${ctx.destAsset}
- Estimated rate: ${estimatedSrc > 0 && destAmt > 0 ? (estimatedSrc / destAmt).toFixed(4) : "?"} ${ctx.srcAsset} per ${ctx.destAsset}
- Path found by Horizon: ${ctx.pathLabels.length > 0 ? "YES" : "NO (using direct route fallback estimate)"}

Make your decision now.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      system: AXIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: contextMessage }],
      tools: [
        {
          name: "make_swap_decision",
          description: "Output the AXIS Brain's financial decision for this swap request",
          input_schema: {
            type: "object" as const,
            properties: {
              thinkingLog: {
                type: "array",
                items: { type: "string" },
                description: "Step-by-step AI reasoning log (4-6 entries, each prefixed naturally, no bullet symbols)",
              },
              dynamicFee: {
                type: "string",
                description: "Service fee in XLM (e.g. '0.001' or '0.003'). Base is 0.001 XLM.",
              },
              feeReason: {
                type: "string",
                description: "One-sentence justification for the fee amount",
              },
              riskLevel: {
                type: "string",
                enum: ["low", "medium", "high"],
                description: "Overall risk assessment for this transaction",
              },
              approved: {
                type: "boolean",
                description: "Whether AXIS approves executing this swap",
              },
              pathRecommendation: {
                type: "string",
                description: "Recommended route string (e.g. 'XLM → USDC direct')",
              },
              summary: {
                type: "string",
                description: "One-sentence executive summary of the decision",
              },
            },
            required: [
              "thinkingLog",
              "dynamicFee",
              "feeReason",
              "riskLevel",
              "approved",
              "pathRecommendation",
              "summary",
            ],
          },
        },
      ],
      tool_choice: { type: "tool", name: "make_swap_decision" },
    });

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      throw new Error("Brain did not return a tool_use block");
    }

    const decision = toolBlock.input as BrainDecision;
    logger.info({ riskLevel: decision.riskLevel, fee: decision.dynamicFee, approved: decision.approved }, "AXIS Brain decision made");
    return decision;
  } catch (err) {
    logger.error({ err }, "AXIS Brain error — using safe defaults");
    return {
      thinkingLog: [
        "Brain temporarily unavailable — applying safe defaults",
        `Swap: ${ctx.destAmount} ${ctx.destAsset} via ${ctx.srcAsset}`,
        "Risk assessment: standard parameters applied",
        "Default fee: 0.001 XLM — proceeding with execution",
      ],
      dynamicFee: "0.001",
      feeReason: "Default fee applied (brain fallback)",
      riskLevel: "low",
      approved: true,
      pathRecommendation: `${ctx.srcAsset} → ${ctx.destAsset}`,
      summary: `Executing ${ctx.destAmount} ${ctx.destAsset} swap with default parameters.`,
    };
  }
}
