"use client";

import { useState } from "react";
import type { Address, Hex } from "viem";
import { Spinner } from "@/app/components/Spinner";
import { connectWallet, sendAndWait } from "@/lib/browser-wallet";

export type PayCalldata = {
  approve: { to: string; data: string; value: string };
  payInvoice: { to: string; data: string; value: string };
};

type Props = {
  paymentStatus: string;
  pay: PayCalldata | null;
  payReason?: string | null;
  onPaid: () => Promise<void>;
};

export function WalletPayButton({
  paymentStatus,
  pay,
  payReason,
  onPaid,
}: Props) {
  const [address, setAddress] = useState<Address | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);

  if (paymentStatus === "paid") {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-ok">
        Paid
      </p>
    );
  }

  if (!pay) {
    return (
      <p className="text-sm text-muted">
        Not payable{payReason ? `: ${payReason}` : ""}
      </p>
    );
  }

  async function onConnect() {
    setError(null);
    setBusy(true);
    setPhase("Connecting…");
    try {
      const addr = await connectWallet();
      setAddress(addr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connect failed");
    } finally {
      setBusy(false);
      setPhase(null);
    }
  }

  async function onApproveAndPay() {
    if (!address || !pay) return;
    setError(null);
    setBusy(true);
    try {
      setPhase("Approve…");
      await sendAndWait({
        account: address,
        to: pay.approve.to as Address,
        data: pay.approve.data as Hex,
      });
      setPhase("Pay…");
      await sendAndWait({
        account: address,
        to: pay.payInvoice.to as Address,
        data: pay.payInvoice.data as Hex,
      });
      setPhase("Refreshing…");
      await onPaid();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
      setPhase(null);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {busy ? <Spinner label={phase ?? "Working…"} /> : null}
      {!busy && !address ? (
        <button
          type="button"
          onClick={onConnect}
          className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
        >
          Connect wallet
        </button>
      ) : null}
      {!busy && address ? (
        <button
          type="button"
          onClick={onApproveAndPay}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-hover"
        >
          Approve &amp; Pay
        </button>
      ) : null}
      {address ? (
        <p className="font-mono text-xs text-muted">
          Connected: {address.slice(0, 6)}…{address.slice(-4)}
        </p>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
