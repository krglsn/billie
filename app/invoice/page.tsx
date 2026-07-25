"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Spinner } from "@/app/components/Spinner";
import {
  WalletPayButton,
  type PayCalldata,
} from "@/app/components/WalletPayButton";

type VerifyBadge = {
  ok: boolean;
  label: string;
  reason?: string | null;
};

type ResolveResponse = {
  ok?: boolean;
  error?: string;
  fullName?: string;
  invoiceId?: string | null;
  amount?: string | null;
  amountDisplay?: string | null;
  currency?: string | null;
  currencyDisplay?: string | null;
  token?: string | null;
  tokenMeta?: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  } | null;
  paymentAddress?: string | null;
  paymentStatus?: string;
  paidOnRouter?: boolean | null;
  texts?: Record<string, string | undefined>;
  pay?: PayCalldata | null;
  routerCheck?: { reason?: string } | null;
  verification?: {
    human: VerifyBadge;
    agent: VerifyBadge;
    attestation: VerifyBadge;
  };
};

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "paid") return "bg-emerald-50 text-ok ring-emerald-200";
  if (s === "open") return "bg-sky-50 text-sky-800 ring-sky-200";
  if (s === "cancelled" || s === "rejected") {
    return "bg-rose-50 text-danger ring-rose-200";
  }
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

function Badge({ ok, label, reason }: VerifyBadge) {
  return (
    <span
      title={reason ?? undefined}
      className={`ml-2 inline-flex align-middle rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
        ok
          ? "bg-emerald-50 text-ok ring-emerald-200"
          : "bg-rose-50 text-danger ring-rose-200"
      }`}
    >
      {label}
    </span>
  );
}

function InvoiceDetail() {
  const searchParams = useSearchParams();
  const name = searchParams.get("name")?.trim() ?? "";
  const [data, setData] = useState<ResolveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!name) {
      setError("Missing invoice name");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const maxAttempts = 3;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(
          `/api/invoices/resolve?name=${encodeURIComponent(name)}`,
        );
        const body = (await res.json()) as ResolveResponse;
        if (!res.ok) {
          const msg = body.error ?? `Resolve failed (${res.status})`;
          const retryable =
            res.status === 502 ||
            msg === "Failed to read PaymentRouter" ||
            msg.includes("PaymentRouter");
          if (retryable && attempt < maxAttempts) {
            lastError = msg;
            await new Promise((r) => setTimeout(r, 400 * attempt));
            continue;
          }
          throw new Error(msg);
        }
        setData(body);
        setError(null);
        setLoading(false);
        return;
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Failed to resolve invoice";
        lastError = msg;
        const retryable =
          msg === "Failed to read PaymentRouter" ||
          msg.includes("PaymentRouter") ||
          msg.includes("fetch");
        if (retryable && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 400 * attempt));
          continue;
        }
        setError(msg);
        setData(null);
        setLoading(false);
        return;
      }
    }

    setError(lastError ?? "Failed to resolve invoice");
    setData(null);
    setLoading(false);
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  const agentFromQuery = searchParams.get("agent")?.trim() ?? "";
  const domainFromQuery = searchParams.get("domain")?.trim() ?? "";
  const agent =
    data?.texts?.["billie.agent"] ?? (agentFromQuery || null);
  const humanId = data?.texts?.["billie.humanId"] ?? null;
  const fullName = data?.fullName ?? null;
  const ensExplorerUrl = fullName
    ? `https://explorer.ens.dev/${fullName}`
    : null;
  const domainForBack =
    domainFromQuery ||
    data?.texts?.["billie.recipient"] ||
    (fullName ? fullName.split(".").slice(1).join(".") : "");
  const agentForBack = (agentFromQuery || agent || "").toLowerCase();
  const dashboardHref =
    agentForBack && domainForBack
      ? `/?agent=${encodeURIComponent(agentForBack)}&domain=${encodeURIComponent(domainForBack)}`
      : "/";

  const amountLabel = data
    ? data.amountDisplay
      ? data.tokenMeta?.symbol
        ? `${data.amountDisplay} ${data.tokenMeta.symbol}`
        : data.amountDisplay
      : data.amount
    : null;

  const v = data?.verification;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link
        href={dashboardHref}
        className="text-sm font-medium text-accent transition hover:text-accent-hover"
      >
        ← Dashboard
      </Link>

      <header className="mt-6 mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Invoice
        </h1>
        <p className="mt-1 text-sm text-muted">
          Review details, connect a wallet, then approve and pay on Sepolia.
        </p>
      </header>

      {loading ? (
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <Spinner label="Loading invoice…" />
        </div>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {!loading && data ? (
        <>
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-line">
                <tr>
                  <th className="w-40 bg-slate-50/80 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted">
                    Name
                  </th>
                  <td className="px-4 py-3 font-mono text-xs sm:text-sm">
                    {fullName ?? "—"}
                    {ensExplorerUrl ? (
                      <>
                        {" "}
                        <a
                          href={ensExplorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1 font-sans text-xs font-medium text-accent hover:text-accent-hover"
                        >
                          ENS ↗
                        </a>
                      </>
                    ) : null}
                  </td>
                </tr>
                <tr>
                  <th className="w-40 bg-slate-50/80 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted">
                    Status
                  </th>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusClass(data.paymentStatus ?? "open")}`}
                    >
                      {data.paymentStatus ?? "—"}
                    </span>
                  </td>
                </tr>
                <tr>
                  <th className="w-40 bg-slate-50/80 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted">
                    Invoice ID
                  </th>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap sm:text-sm">
                    {data.invoiceId ?? "—"}
                  </td>
                </tr>
                <tr>
                  <th className="w-40 bg-slate-50/80 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted">
                    Amount
                  </th>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap sm:text-sm">
                    {amountLabel ?? "—"}
                  </td>
                </tr>
                <tr>
                  <th className="w-40 bg-slate-50/80 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted">
                    Payment address
                  </th>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap sm:text-sm">
                    {data.paymentAddress ?? "—"}
                  </td>
                </tr>
                <tr>
                  <th className="w-40 bg-slate-50/80 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted">
                    Agent
                  </th>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap sm:text-sm">
                    {agent ?? "—"}
                    {v?.agent ? <Badge {...v.agent} /> : null}
                  </td>
                </tr>
                <tr>
                  <th className="w-40 bg-slate-50/80 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted">
                    Human ID
                  </th>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap sm:text-sm">
                    {humanId ?? "—"}
                    {v?.human ? <Badge {...v.human} /> : null}
                  </td>
                </tr>
                <tr>
                  <th className="w-40 bg-slate-50/80 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted">
                    Attestation
                  </th>
                  <td className="px-4 py-3 text-sm">
                    {v?.attestation ? (
                      <Badge {...v.attestation} />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <section className="mt-6 rounded-2xl border border-line bg-surface p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Payment
            </h2>
            <WalletPayButton
              paymentStatus={data.paymentStatus ?? "open"}
              pay={data.pay ?? null}
              payReason={data.routerCheck?.reason}
              onPaid={load}
            />
          </section>
        </>
      ) : null}
    </main>
  );
}

export default function InvoicePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-5xl px-4 py-10">
          <Spinner label="Loading…" />
        </main>
      }
    >
      <InvoiceDetail />
    </Suspense>
  );
}
