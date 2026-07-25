"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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

  const domains = useMemo(() => {
    const selected = agents.find((a) => a.agentAddress === agent);
    return selected?.domains ?? [];
  }, [agents, agent]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingAgents(true);
      setError(null);
      try {
        const res = await fetch("/api/agents");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load agents");
        if (!cancelled) setAgents(body.agents ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load agents");
        }
      } finally {
        if (!cancelled) setLoadingAgents(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setDomain("");
    setInvoices([]);
  }, [agent]);

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

  useEffect(() => {
    void loadInvoices(agent, domain);
  }, [agent, domain, loadInvoices]);

  return (
    <main className="page">
      <h1>Billie</h1>
      <p className="lede">Pay invoices issued by human-backed agents.</p>

      <label className="field">
        <span>Agent</span>
        {loadingAgents ? (
          <Spinner label="Loading agents…" />
        ) : (
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            disabled={agents.length === 0}
          >
            <option value="">
              {agents.length === 0 ? "No linked agents" : "Select agent…"}
            </option>
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
