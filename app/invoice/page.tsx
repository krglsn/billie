"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Spinner } from "@/app/components/Spinner";
import {
  WalletPayButton,
  type PayCalldata,
} from "@/app/components/WalletPayButton";

type ResolveResponse = {
  ok?: boolean;
  error?: string;
  fullName?: string;
  invoiceId?: string | null;
  amount?: string | null;
  currency?: string | null;
  token?: string | null;
  paymentAddress?: string | null;
  paymentStatus?: string;
  paidOnRouter?: boolean | null;
  texts?: Record<string, string | undefined>;
  pay?: PayCalldata | null;
  routerCheck?: { reason?: string } | null;
};

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
    try {
      const res = await fetch(
        `/api/invoices/resolve?name=${encodeURIComponent(name)}`,
      );
      const body = (await res.json()) as ResolveResponse;
      if (!res.ok) {
        throw new Error(body.error ?? `Resolve failed (${res.status})`);
      }
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resolve invoice");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  const agent = data?.texts?.["billie.agent"] ?? null;
  const humanId = data?.texts?.["billie.humanId"] ?? null;

  const rows: [string, string | null | undefined][] = data
    ? [
        ["Name", data.fullName],
        ["Invoice ID", data.invoiceId],
        ["Amount", data.amount],
        ["Currency", data.currency],
        ["Token", data.token],
        ["Payment address", data.paymentAddress],
        ["Status", data.paymentStatus],
        ["Agent", agent],
        ["Human ID", humanId],
      ]
    : [];

  return (
    <main className="page">
      <p>
        <Link href="/">← Dashboard</Link>
      </p>
      <h1>Invoice</h1>

      {loading ? <Spinner label="Loading invoice…" /> : null}
      {error ? <p className="error">{error}</p> : null}

      {!loading && data ? (
        <>
          <table className="data details">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td className="mono">{value ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="pay-section">
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
    <Suspense fallback={<main className="page"><Spinner label="Loading…" /></main>}>
      <InvoiceDetail />
    </Suspense>
  );
}
