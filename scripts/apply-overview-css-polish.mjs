import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/dashboard/src/pages/OperationsDashboard.css";
const css = readFileSync(path, "utf8");
const marker = "/* Overview density and light-theme polish */";

if (css.includes(marker)) {
  throw new Error("Overview polish already applied");
}

const overrides = `

${marker}
.ops-layout {
  grid-template-columns: 1fr;
  gap: 14px;
}

.ops-layout__supporting {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.ops-secondary-cards {
  gap: 14px;
}

.ops-console {
  gap: 14px;
}

.ops-card,
.ops-alert {
  box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
}

.ops-alert {
  background: color-mix(in srgb, var(--tc-bg-surface) 84%, #fee2e2);
  border-color: color-mix(in srgb, var(--tc-border-default) 58%, #dc2626);
}

.ops-alert--healthy {
  background: color-mix(in srgb, var(--tc-bg-surface) 86%, #d1fae5);
  border-color: color-mix(in srgb, var(--tc-border-default) 62%, #059669);
}

.ops-alert p,
.ops-alert__reported span,
.ops-alert__reported small {
  color: var(--tc-text-secondary);
}

.ops-alert__icon {
  color: #991b1b;
  background: color-mix(in srgb, var(--tc-bg-surface) 70%, #fecaca);
}

.ops-alert--healthy .ops-alert__icon {
  color: #065f46;
  background: color-mix(in srgb, var(--tc-bg-surface) 72%, #a7f3d0);
}

.ops-status--danger {
  color: #991b1b;
  background: color-mix(in srgb, var(--tc-bg-surface) 70%, #fecaca);
  border-color: color-mix(in srgb, var(--tc-border-default) 55%, #dc2626);
}

.ops-status--neutral {
  color: var(--tc-text-secondary);
  background: var(--tc-bg-subtle);
  border-color: var(--tc-border-default);
}

.ops-status--healthy {
  color: #065f46;
  background: color-mix(in srgb, var(--tc-bg-surface) 72%, #a7f3d0);
  border-color: color-mix(in srgb, var(--tc-border-default) 58%, #059669);
}

.ops-status--warning {
  color: #92400e;
  background: color-mix(in srgb, var(--tc-bg-surface) 70%, #fde68a);
  border-color: color-mix(in srgb, var(--tc-border-default) 58%, #d97706);
}

.ops-inline-action,
.ops-card__header > a {
  color: var(--tc-blue-600);
}

.ops-inline-action:hover,
.ops-card__header > a:hover {
  color: var(--tc-blue-700);
}

.ops-overflow > summary:hover {
  background: var(--tc-bg-subtle);
}

@media (max-width: 760px) {
  .ops-layout__supporting {
    grid-template-columns: 1fr;
  }
}
`;

writeFileSync(path, css.trimEnd() + overrides + "\n");
