# AXIS — Demo Script (Stellar Agents Hackathon)

**AXIS: Autonomous X-border Interchange System**
Agent-to-Agent Liquidity Infrastructure on Stellar Testnet

---

## Video Demo Outline (≈3 menit)

### [0:00–0:20] Hook — Masalah

> "AI agents perlu menukar aset lintas chain. Tapi siapa yang menangani liquidity, payment gating, dan route discovery? Itu pekerjaan manusia — sampai sekarang."

Tampilkan: halaman home AXIS dengan 3 card (AXIS Node, Demo Agent, API Reference).

---

### [0:20–0:50] Penjelasan Arsitektur

> "AXIS adalah open liquidity API untuk AI agents di Stellar Testnet. Agent eksternal mana pun bisa mengirim XLM ke AXIS via MPP — Machine Payments Protocol — dan menerima aset target langsung ke wallet mereka. Sepenuhnya on-chain. Tanpa kustodian."

Tampilkan: diagram flow di API Reference panel:
```
Agent → GET /axis/quote → dapatkan totalRequired XLM
Agent → POST /axis/convert (+ MPP 402 payment)
      → AXIS PathPayment → destAsset dikirim ke agentAddress
```

---

### [0:50–2:00] Live Demo — Full 8-Step Flow

Buka **AXIS Dashboard → Demo Agent** tab. Pilih:
- Source: XLM
- Destination: CAT (atau USDC)
- Amount: 0.5

Klik **"Run Autonomous Swap"**.

Sambil steps berjalan, narasikan setiap step:

**[SCAN]**
> "AXIS cek saldo Demo Agent — ada cukup XLM — lalu scan AMM pools untuk menemukan route terbaik."

**[THINK]**
> "Claude Haiku menganalisis transaksi: evaluasi risiko, set dynamic fee, dan membuat keputusan. Kamu bisa lihat chain-of-thought reasoning-nya langsung di sini."

**[QUOTE]**
> "AXIS hitung berapa XLM yang dibutuhkan agent: sourceAmount untuk PathPayment, ditambah service fee. Total ini yang akan dicharge via MPP."

**[402 → PAYMENT]**
> "AXIS balas POST /axis/convert dengan HTTP 402. Demo Agent menerima MPP challenge, membangun Soroban SAC XLM transfer, broadcast ke Stellar Testnet. Lihat tx hash-nya — ini real, on-chain."

**[SWAP]**
> "Begitu pembayaran terverifikasi, AXIS eksekusi PathPaymentStrictReceive. XLM diswap ke CAT lewat AMM pool. Stellar settles dalam 5 detik."

**[DONE]**
> "CAT diterima di wallet Demo Agent. Balance update real-time. Explorer link bisa diklik untuk verifikasi on-chain."

---

### [2:00–2:30] External Agent Integration

Buka **API Reference** panel. Tampilkan code example mppx:

> "Ini bukan hanya demo — ini open API. Agent luar mana pun bisa integrate dengan 3 langkah: quote, setup mppx, execute. AXIS selalu siap karena ada auto-solvency check — jika treasury AXIS mendekati kosong, Friendbot otomatis refill tanpa restart."

Highlight bagian key dari mppx example:
```typescript
// 1. Get quote
const { quote } = await quoteRes.json();
// quote.totalRequired = "2.5010000" XLM

// 2. mppxClient handles 402 → pay → retry automatically
const response = await mppxClient.fetch(`/axis/convert`, {
  headers: { "X-Axis-Fee": quote.totalRequired },
  body: JSON.stringify({ destAmount: "1", destAsset: "USDC", agentAddress: ... }),
});
```

---

### [2:30–3:00] Closing

> "AXIS: open, modular, always-on liquidity infrastructure untuk Stellar agents. Powered by MPP, Claude AI, dan AMM pool discovery. Siap untuk production. Siap untuk agent-to-agent economy."

Tampilkan: transaction history yang sudah terisi dari demo tadi + explorer links.

---

## Live Test Commands

Jalankan di terminal untuk demo yang lebih teknikal:

```bash
# 1. Check AXIS status
curl -s https://your-axis-url/api/axis/status | jq .

# 2. Get quote
curl -s "https://your-axis-url/api/axis/quote?srcAsset=XLM&destAsset=CAT&destAmount=0.5&agentAddress=GBOILRL4C5K74FLP4MJ27STY37ASSQPKOHOQ2UORZFYIG5FWLQHBFLDF" | jq .quote

# 3. Trigger full autonomous 8-step flow
curl -s -X POST https://your-axis-url/api/axis/demo/trigger \
  -H "Content-Type: application/json" \
  -d '{"destAsset":"CAT","destAmount":"0.5","srcAsset":"XLM"}' | jq '{
    success: .success,
    steps: [.steps[] | {step: .step, status: .status}],
    totalPaid: .result.totalPaid,
    output: "\(.result.outputAmount) \(.result.outputAsset)",
    swapHash: .result.swapHash
  }'

# 4. View transaction history
curl -s "https://your-axis-url/api/axis/transactions?limit=5" | jq '.transactions[] | {hash: .stellarTxHash, route: .route, amount: .outputAmount}'
```

---

## Expected Demo Output (Steps)

```json
{
  "success": true,
  "steps": [
    { "step": "BALANCE",  "status": "Balance checked" },
    { "step": "SCAN",     "status": "AMM pool route discovered" },
    { "step": "THINK",    "status": "Decision: APPROVED" },
    { "step": "QUOTE",    "status": "Swap quote received" },
    { "step": "402",      "status": "MPP Payment Required" },
    { "step": "PAYMENT",  "status": "Agent funds sent to AXIS via Soroban SAC" },
    { "step": "SWAP",     "status": "PathPaymentStrictReceive executed" },
    { "step": "DONE",     "status": "CAT received" }
  ],
  "result": {
    "sourceAmount": "0.5000000",
    "fee": "0.0010000",
    "totalPaid": "0.5010000",
    "outputAmount": "0.5",
    "outputAsset": "CAT",
    "route": "XLM → CAT",
    "feeHash": "ded04ce881adce2d...",
    "swapHash": "c5fd12641fa9110e...",
    "explorerUrl": "https://stellar.expert/explorer/testnet/tx/c5fd12..."
  }
}
```

---

## Key Differentiators

| Fitur | AXIS | Solusi lain |
|-------|------|-------------|
| Payment protocol | MPP (draft-stellar-charge-00) | x402, API key, whitelist |
| Agent autonomy | Fully autonomous (no human in loop) | Manual approval |
| Route discovery | AMM + DEX dua-pass pathfinding | Static pairs only |
| AI analysis | Claude Haiku per-swap | Tidak ada |
| Dynamic fee | AI-set (0.0005–0.005 XLM) | Fixed |
| Agent funding | Agent funds own swap via MPP | Kustodian |
| Trustline check | Pre-check + helpful error | Gagal diam-diam |
| Treasury solvency | Auto-refill via Friendbot | Manual refill |
| Transaction history | PostgreSQL + explorer links | Tidak ada |
| Integration | Open API, mppx 3 lines | Walled garden |

---

## Hackathon Submission Checklist

- [x] MPP (Machine Payments Protocol) — `@stellar/mpp` + `mppx`
- [x] Stellar Testnet (real transactions, real on-chain settlement)
- [x] AI agent (Claude Haiku financial brain, dynamic fee, risk analysis)
- [x] Agent-to-agent protocol (Demo Agent ↔ AXIS Treasury)
- [x] PathPaymentStrictReceive (AMM + DEX routing)
- [x] Dynamic asset pair discovery
- [x] Persistent transaction history (PostgreSQL)
- [x] Open API for external agents
- [x] Auto-solvency (always ready)
- [x] Trustline pre-check (safety)
- [x] Dashboard (real-time steps, AI reasoning, explorer links)

---

## ElevenLabs TTS Script

Copy teks di bawah ini langsung ke ElevenLabs. Tanda koma dan titik sudah disesuaikan untuk jeda alami sesuai timing video.

---

### [0:00 – 0:20] Hook

"AI agents need to swap assets, settle payments, and move liquidity, autonomously, without any human in the loop. But who handles the routing, the payment gating, and the on-chain settlement? Until now, that was a human's job. Meet AXIS."

---

### [0:20 – 0:50] Architecture

"AXIS is an open liquidity A P I, built for AI agents, on Stellar Testnet. Any external agent can send X L M to AXIS, using M P P, the Machine Payments Protocol, and receive any target asset, directly in their wallet. No custodian. No whitelist. No API key. Just pay the fee, and the swap happens, fully on-chain."

"Every request starts with a quote. The agent learns exactly how much X L M is needed, including the service fee. That total becomes the M P P charge amount. AXIS then executes a Path Payment Strict Receive on Stellar, routing through A M M pools, and delivers the destination asset, straight to the agent's address."

---

### [0:50 – 1:00] Demo Start

"Let's watch the full eight-step flow, live. Source asset: X L M. Destination: C A T token. Amount: zero point five. The Demo Agent is fully autonomous. No human input after this click."

---

### [1:00 – 1:12] Step BALANCE + SCAN

"Step one. AXIS checks the Demo Agent's balance, and confirms there is enough X L M to proceed. Then it runs a two-pass A M M pool scan, to discover the best route from X L M to C A T."

---

### [1:12 – 1:28] Step THINK

"Step two. Claude Haiku, the A I financial brain, analyzes this swap. It evaluates risk, slippage, and market conditions. It sets a dynamic fee. And it makes a decision: approved. You can see the full chain-of-thought reasoning, right here in the dashboard."

---

### [1:28 – 1:40] Step QUOTE

"Step three. AXIS calculates the exact source amount needed for this Path Payment, and adds the A I-set service fee. The agent now knows the total X L M required. This is the M P P charge amount."

---

### [1:40 – 1:55] Step 402 + PAYMENT

"Step four and five. The Demo Agent sends a P O S T request to AXIS. AXIS replies with H T T P four zero two, Payment Required, an M P P challenge. The agent builds a Soroban S A C transfer, signs it, and broadcasts it to Stellar Testnet. Watch the transaction hash appear. This is a real, on-chain payment."

---

### [1:55 – 2:10] Step SWAP + DONE

"Step six and seven. AXIS verifies the payment on-chain. Confirms the agent's trustline for C A T. Then executes Path Payment Strict Receive, through the A M M pool. Stellar settles in five seconds. C A T arrives in the Demo Agent's wallet. Balance updated. Explorer link is live. Swap complete."

---

### [2:10 – 2:30] External Agent Integration

"AXIS is not just a demo. It is an open A P I. Any A I agent can integrate in three steps. Get a quote. Set up an M P P X client to handle the four-zero-two automatically. Then call slash axis slash convert. That is it. The M P P X library handles the challenge, the payment, and the retry, without any extra code."

"External agents bring their own funds. AXIS never holds custody. The treasury runs indefinitely, because every swap is self-funded by the agent making the request."

---

### [2:30 – 3:00] Closing

"AXIS is open, modular, and always ready. Powered by M P P, Claude A I, and A M M pool discovery. Any agent, any asset pair, any time. This is the liquidity layer that Stellar agents have been waiting for."

"AXIS: Autonomous X-border Interchange System. Built for the Stellar Agents Hackathon."

---

## Stellar Explorer Links

- AXIS Treasury: https://stellar.expert/explorer/testnet/account/GCXVRIXJGGPEBP76SVBEA2TGPPBJVZWU3Y2QIQH65GA7FFHTGIK4VHCD
- Demo Agent: https://stellar.expert/explorer/testnet/account/GBOILRL4C5K74FLP4MJ27STY37ASSQPKOHOQ2UORZFYIG5FWLQHBFLDF
