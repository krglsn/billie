export function Spinner({ label }: { label?: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 text-sm text-muted"
      role="status"
      aria-live="polite"
    >
      <span
        className="size-4 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-accent"
        aria-hidden
      />
      {label ? <span>{label}</span> : null}
    </span>
  );
}
