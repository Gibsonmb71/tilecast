export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`brand ${compact ? "brand--compact" : ""}`}
      aria-label="Tilecast"
    >
      <span className="brand__mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="brand__name">Tilecast</span>
    </div>
  );
}
