import React from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Cpu, Wallet, BookOpen } from "lucide-react";

const ROLES = [
  {
    id: "axis",
    path: "/axis",
    icon: Cpu,
    title: "AXIS Node",
    subtitle: "Autonomous X-border Interchange System",
    description:
      "Monitor the AXIS liquidity node. View MPP fee collections, PathPayment routing, and live transaction throughput in real time.",
    color: "primary",
    accent: "rgba(99,102,241,0.15)",
    border: "rgba(99,102,241,0.4)",
    glow: "rgba(99,102,241,0.3)",
  },
  {
    id: "agent",
    path: "/agent",
    icon: Wallet,
    title: "Demo Agent",
    subtitle: "Consumer Agent Wallet",
    description:
      "Experience the agent side. Trigger a full cross-border swap, watch MPP payment gating in action, and receive any Stellar asset.",
    color: "success",
    accent: "rgba(16,185,129,0.12)",
    border: "rgba(16,185,129,0.35)",
    glow: "rgba(16,185,129,0.25)",
  },
  {
    id: "api-ref",
    path: "/api-ref",
    icon: BookOpen,
    title: "API Reference",
    subtitle: "For External Agents & Integrators",
    description:
      "Connect your own agent to AXIS. Browse endpoints, copy mppx code snippets, and integrate MPP Stellar Charge payment gating in minutes.",
    color: "warning",
    accent: "rgba(245,158,11,0.10)",
    border: "rgba(245,158,11,0.35)",
    glow: "rgba(245,158,11,0.2)",
  },
];

export default function Home() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-[100dvh] w-full bg-background text-foreground flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(99,102,241,0.07) 0%, transparent 70%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-12 text-center"
      >
        <div className="flex items-center justify-center gap-3 mb-4">
          <img src="/logo.png" alt="AXIS" className="w-10 h-10 rounded-xl object-cover" />
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-primary via-primary/80 to-primary/50 bg-clip-text text-transparent">
            AXIS
          </h1>
        </div>
        <p className="text-muted-foreground text-sm font-mono tracking-widest uppercase">
          Autonomous X-border Interchange System
        </p>
        <p className="text-muted-foreground/60 text-xs mt-2">
          Agent Liquidity Infrastructure on Stellar Testnet via MPP Protocol
        </p>
      </motion.div>

      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-5">
        {ROLES.map((role, idx) => {
          const Icon = role.icon;
          return (
            <motion.button
              key={role.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 + idx * 0.1 }}
              whileHover={{ scale: 1.02, y: -3 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setLocation(role.path)}
              className="group relative text-left rounded-2xl border p-6 flex flex-col gap-4 cursor-pointer transition-all duration-300 focus:outline-none"
              style={{
                backgroundColor: role.accent,
                borderColor: role.border,
                boxShadow: `0 0 0 0 ${role.glow}`,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = `0 0 30px 5px ${role.glow}`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 0 ${role.glow}`;
              }}
            >
              <div className="flex items-start justify-between">
                <div
                  className="p-3 rounded-xl border"
                  style={{ backgroundColor: role.accent, borderColor: role.border }}
                >
                  <Icon className={`w-6 h-6 text-${role.color}`} />
                </div>
                <ArrowRight
                  className={`w-5 h-5 text-${role.color} opacity-0 group-hover:opacity-100 transition-opacity mt-1`}
                />
              </div>

              <div>
                <h2 className={`text-xl font-bold text-${role.color} tracking-tight`}>
                  {role.title}
                </h2>
                <p className="text-xs font-mono text-muted-foreground mt-0.5">{role.subtitle}</p>
              </div>

              <p className="text-sm text-muted-foreground/80 leading-relaxed">{role.description}</p>

              <div
                className={`mt-auto pt-4 border-t text-xs font-mono text-${role.color} opacity-60 group-hover:opacity-100 transition-opacity`}
                style={{ borderColor: role.border }}
              >
                Enter as {role.title} →
              </div>
            </motion.button>
          );
        })}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="mt-10 text-muted-foreground/40 text-xs font-mono"
      >
        Stellar Agents Hackathon Demo · Testnet Only
      </motion.p>
    </div>
  );
}
