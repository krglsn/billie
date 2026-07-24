export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: "40rem" }}>
      <h1>Billie API</h1>
      <p>Stage 1: human-backed agent API. Web UI deferred.</p>
      <ul>
        <li>
          <code>GET /api/health</code> — public health check
        </li>
      </ul>
    </main>
  );
}
