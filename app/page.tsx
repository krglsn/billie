"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
      className={spinning ? "icon-refresh-svg is-spinning" : "icon-refresh-svg"}
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

export default function Home() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agent, setAgent] = useState("");
  const [domain, setDomain] = useState("");
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
    <main className="page">
      <h1>Billie</h1>
      <p className="lede">Pay invoices issued by human-backed agents.</p>

      <div className="field">
        <span>Agent</span>
        {loadingAgents && agents.length === 0 ? (
          <Spinner label="Loading agents…" />
        ) : agents.length === 0 ? (
          <div className="field-row">
            <p className="muted field-row-grow">No agents found in database.</p>
            <button
              type="button"
              className="icon-refresh"
              aria-label="Refresh agents"
              title="Refresh agents"
              onClick={() => void refreshAgents()}
              disabled={loadingAgents}
            >
              <RefreshIcon spinning={loadingAgents} />
            </button>
          </div>
        ) : (
          <div className="field-row">
            <select
              value={agent}
              onChange={(e) => {
                setAgent(e.target.value);
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
              className="icon-refresh"
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
        <div className="field">
          <span>Domain</span>
          <div className="field-row">
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
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
              className="icon-refresh"
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

      {error ? <p className="error">{error}</p> : null}

      {agent && domain ? (
        <section>
          <h2>Invoices</h2>
          {loadingInvoices ? (
            <Spinner label="Loading invoices…" />
          ) : invoices.length === 0 ? (
            <p className="muted">No invoices for this domain.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Amount</th>
                  <th>Agent</th>
                  <th>Human ID</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.fullName}>
                    <td className="mono">{inv.fullName}</td>
                    <td>{inv.amountLabel ?? "—"}</td>
                    <td className="mono">{inv.agentAddress}</td>
                    <td className="mono">{inv.humanId}</td>
                    <td>{inv.paymentStatus}</td>
                    <td>
                      <Link
                        href={`/invoice?name=${encodeURIComponent(inv.fullName)}`}
                      >
                        Pay
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </main>
  );
}
