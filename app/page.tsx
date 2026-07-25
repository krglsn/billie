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

export default function Home() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agent, setAgent] = useState("");
  const [domain, setDomain] = useState("");
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
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
    setLoadingAgents(true);
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
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    const selection = await loadAgents();
    if (selection.agent && selection.domain) {
      await loadInvoices(selection.agent, selection.domain);
    } else {
      setInvoices([]);
    }
  }, [loadAgents, loadInvoices]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    void loadInvoices(agent, domain);
  }, [agent, domain, loadInvoices]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshAll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshAll]);

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1>Billie</h1>
          <p className="lede">Pay invoices issued by human-backed agents.</p>
        </div>
        <button
          type="button"
          className="button-secondary"
          onClick={() => void refreshAll()}
          disabled={loadingAgents || loadingInvoices}
        >
          {loadingAgents ? <Spinner label="Refreshing…" /> : "Refresh"}
        </button>
      </div>

      <label className="field">
        <span>Agent</span>
        {loadingAgents && agents.length === 0 ? (
          <Spinner label="Loading agents…" />
        ) : agents.length === 0 ? (
          <p className="muted">No agents found in database.</p>
        ) : (
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
        )}
      </label>

      {agent ? (
        <label className="field">
          <span>Domain</span>
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={domains.length === 0}
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
        </label>
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
