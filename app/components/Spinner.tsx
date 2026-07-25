export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-live="polite">
      <span className="spinner-dot" aria-hidden />
      {label ? <span className="spinner-label">{label}</span> : null}
    </span>
  );
}
