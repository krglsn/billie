"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/app/components/Spinner";

type Agent = {
  agentAddress: string;
  humanId: string;
  domains: string[];
};

type InvoiceRow = {
  fullName: string;
  agentAddress: string;
  humanId: string;
  amountLabel?: string;
  paymentStatus: string;
};

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={spinning ? "animate-spin" : undefined}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M13.65 2.35A8 8 0 1 0 16 8h-2a6 6 0 1 1-1.76-4.24L10 6h6V0l-2.35 2.35z"
      />
    </svg>
  );
}

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "paid") return "bg-emerald-50 text-ok ring-emerald-200";
  if (s === "open") return "bg-sky-50 text-sky-800 ring-sky-200";
  if (s === "cancelled" || s === "rejected") {
    return "bg-rose-50 text-danger ring-rose-200";
  }
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

/** Shorten long ids/addresses: 0x1234…abcd */
function middleEllipsis(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function Dashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [agent, setAgent] = useState(
    () => searchParams.get("agent")?.toLowerCase() ?? "",
  );
  const [domain, setDomain] = useState(
    () => searchParams.get("domain")?.toLowerCase() ?? "",
  );
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentRef = useRef(agent);
  const domainRef = useRef(domain);
  agentRef.current = agent;
  domainRef.current = domain;

  const domains = useMemo(() => {
    const selected = agents.find((a) => a.agentAddress === agent);
    return selected?.domains ?? [];
  }, [agents, agent]);

  // Keep selection in the URL so ← Dashboard can restore it.
  useEffect(() => {
    const params = new URLSearchParams();
    if (agent) params.set("agent", agent);
    if (domain) params.set("domain", domain);
    const qs = params.toString();
    const next = qs ? `${pathname}?${qs}` : pathname;
    const current = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    if (next !== current) {
      router.replace(next, { scroll: false });
    }
  }, [agent, domain, pathname, router, searchParams]);

  // Restore from URL (e.g. browser back / Dashboard link).
  useEffect(() => {
    const a = searchParams.get("agent")?.toLowerCase() ?? "";
    const d = searchParams.get("domain")?.toLowerCase() ?? "";
    if (a !== agentRef.current) setAgent(a);
    if (d !== domainRef.current) setDomain(d);
  }, [searchParams]);

  const loadInvoices = useCallback(
    async (agentAddress: string, domainName: string) => {
      if (!agentAddress || !domainName) {
        setInvoices([]);
        return;
      }
      setLoadingInvoices(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          agent: agentAddress,
          domain: domainName,
        });
        const res = await fetch(`/api/invoices?${qs}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load invoices");
        setInvoices(body.invoices ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load invoices");
        setInvoices([]);
      } finally {
        setLoadingInvoices(false);
      }
    },
    [],
  );

  const loadAgents = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/agents");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load agents");
      const nextAgents = (body.agents ?? []) as Agent[];
      setAgents(nextAgents);

      const prevAgent = agentRef.current;
      const prevDomain = domainRef.current;
      const match = nextAgents.find((a) => a.agentAddress === prevAgent);
      if (!match) {
        setAgent("");
        setDomain("");
        return { agent: "", domain: "" };
      }
      const domainOk = match.domains.includes(prevDomain);
      if (!domainOk) {
        setDomain("");
        return { agent: prevAgent, domain: "" };
      }
      return { agent: prevAgent, domain: prevDomain };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agents");
      return {
        agent: agentRef.current,
        domain: domainRef.current,
      };
    }
  }, []);

  const refreshAgents = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const selection = await loadAgents();
      if (selection.agent && selection.domain) {
        await loadInvoices(selection.agent, selection.domain);
      } else if (!selection.agent) {
        setInvoices([]);
      }
    } finally {
      setLoadingAgents(false);
    }
  }, [loadAgents, loadInvoices]);

  const refreshDomains = useCallback(async () => {
    if (!agentRef.current) return;
    setLoadingDomains(true);
    try {
      const selection = await loadAgents();
      if (selection.agent && selection.domain) {
        await loadInvoices(selection.agent, selection.domain);
      } else if (selection.agent && !selection.domain) {
        setInvoices([]);
      }
    } finally {
      setLoadingDomains(false);
    }
  }, [loadAgents, loadInvoices]);

  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  useEffect(() => {
    void loadInvoices(agent, domain);
  }, [agent, domain, loadInvoices]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshAgents();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshAgents]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="text-sm font-medium tracking-wide text-accent">Billie</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
          Pay dashboard
        </h1>
        <p className="mt-2 max-w-xl text-muted">
          Select a human-backed agent and domain, then settle open invoices on
          Sepolia.
        </p>
      </header>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Agent</label>
            {loadingAgents && agents.length === 0 ? (
              <Spinner label="Loading agents…" />
            ) : agents.length === 0 ? (
              <div className="flex items-center gap-2">
                <p className="flex-1 text-sm text-muted">
                  No agents found in database.
                </p>
                <button
                  type="button"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-white text-slate-600 transition hover:border-slate-400 hover:text-ink disabled:opacity-50"
                  aria-label="Refresh agents"
                  title="Refresh agents"
                  onClick={() => void refreshAgents()}
                  disabled={loadingAgents}
                >
                  <RefreshIcon spinning={loadingAgents} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                  value={agent}
                  onChange={(e) => {
                    setAgent(e.target.value.toLowerCase());
                    setDomain("");
                  }}
                >
                  <option value="">Select agent…</option>
                  {agents.map((a) => (
                    <option key={a.agentAddress} value={a.agentAddress}>
                      {a.agentAddress.slice(0, 10)}… — {a.humanId.slice(0, 10)}…
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-white text-slate-600 transition hover:border-slate-400 hover:text-ink disabled:opacity-50"
                  aria-label="Refresh agents"
                  title="Refresh agents"
                  onClick={() => void refreshAgents()}
                  disabled={loadingAgents}
                >
                  <RefreshIcon spinning={loadingAgents} />
                </button>
              </div>
            )}
          </div>

          {agent ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">
                Domain
              </label>
              <div className="flex items-center gap-2">
                <select
                  className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-slate-50 disabled:text-muted"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value.toLowerCase())}
                  disabled={domains.length === 0 || loadingDomains}
                >
                  <option value="">
                    {domains.length === 0 ? "No domains" : "Select domain…"}
                  </option>
                  {domains.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-white text-slate-600 transition hover:border-slate-400 hover:text-ink disabled:opacity-50"
                  aria-label="Refresh domains"
                  title="Refresh domains"
                  onClick={() => void refreshDomains()}
                  disabled={loadingDomains}
                >
                  <RefreshIcon spinning={loadingDomains} />
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="mt-4 text-sm text-danger">{error}</p>
        ) : null}
      </section>

      {agent && domain ? (
        <section className="mt-6">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">
              Invoices from {domain}
            </h2>
            <p className="font-mono text-xs text-muted" title={agent}>
              {middleEllipsis(agent, 8, 6)}
            </p>
          </div>

          {loadingInvoices ? (
            <div className="rounded-2xl border border-line bg-surface p-6">
              <Spinner label="Loading invoices…" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface/70 px-5 py-8 text-sm text-muted">
              No invoices for this domain.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-slate-50/80 text-xs font-medium uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Human ID</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {invoices.map((inv) => {
                      const payQs = new URLSearchParams({
                        name: inv.fullName,
                        agent,
                        domain,
                      });
                      const href = `/invoice?${payQs}`;
                      return (
                        <tr
                          key={inv.fullName}
                          role="link"
                          tabIndex={0}
                          className="cursor-pointer transition hover:bg-slate-50/60 focus-visible:bg-slate-50/80 focus-visible:outline-none"
                          onClick={() => router.push(href)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              router.push(href);
                            }
                          }}
                        >
                          <td
                            className="max-w-[14rem] truncate px-4 py-3 font-mono text-xs sm:max-w-[18rem] sm:text-sm"
                            title={inv.fullName}
                          >
                            {inv.fullName}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-medium">
                            {inv.amountLabel ?? "—"}
                          </td>
                          <td
                            className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted"
                            title={inv.humanId}
                          >
                            {middleEllipsis(inv.humanId, 8, 6)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusClass(inv.paymentStatus)}`}
                            >
                              {inv.paymentStatus}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="inline-flex rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white">
                              Pay
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-5xl px-4 py-10">
          <Spinner label="Loading…" />
        </main>
      }
    >
      <Dashboard />
    </Suspense>
  );
}
