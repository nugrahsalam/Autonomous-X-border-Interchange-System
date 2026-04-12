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

## Stellar Explorer Links

- AXIS Treasury: https://stellar.expert/explorer/testnet/account/GCXVRIXJGGPEBP76SVBEA2TGPPBJVZWU3Y2QIQH65GA7FFHTGIK4VHCD
- Demo Agent: https://stellar.expert/explorer/testnet/account/GBOILRL4C5K74FLP4MJ27STY37ASSQPKOHOQ2UORZFYIG5FWLQHBFLDF
