export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: "40rem" }}>
      <h1>Billie API</h1>
      <p>Stage 1: human-backed agent API. Web UI deferred.</p>
      <ul>
        <li>
          <code>GET /api/health</code> — public health check
        </li>
        <li>
          <code>GET /api/me</code> — AgentKit-protected identity probe
        </li>
        <li>
          <code>POST /api/domains</code> — claim/link Sepolia ENSv2 ownership
        </li>
        <li>
          <code>POST /api/invoices</code> — prepare invoice subdomain tx
        </li>
        <li>
          <code>POST /api/invoices/submit</code> — broadcast signed invoice tx
        </li>
      </ul>
    </main>
  );
}
