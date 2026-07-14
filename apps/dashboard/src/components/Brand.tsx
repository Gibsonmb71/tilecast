export function Brand({ compact = false }: { compact?: boolean }) {
  if (compact)
    return (
      <img
        className="brand__studio-logo"
        src="/tilecast-studio-logo.svg"
        alt="Tilecast Studio"
      />
    );
  return (
    <div className="brand" aria-label="Tilecast">
      <span className="brand__mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="brand__name">Tilecast</span>
    </div>
  );
}
