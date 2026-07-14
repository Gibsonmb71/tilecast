from pathlib import Path

root = Path(__file__).resolve().parents[1]
page_path = root / "apps/dashboard/src/pages/OperationsDashboard.tsx"
css_path = root / "apps/dashboard/src/pages/OperationsDashboard.css"

page = page_path.read_text()
layout_start = page.index('      <section className="ops-layout">')
primary_open = '        <div className="ops-layout__primary">\n'
primary_start = page.index(primary_open, layout_start) + len(primary_open)
support_marker = '\n        <aside className="ops-layout__supporting">'
support_start_marker = page.index(support_marker, primary_start)
primary_inner = page[primary_start:support_start_marker]
support_open_end = support_start_marker + len(support_marker) + 1
layout_end_marker = '\n        </aside>\n      </section>'
layout_end = page.index(layout_end_marker, support_open_end)
support_inner = page[support_open_end:layout_end]
after_layout = layout_end + len(layout_end_marker)
secondary_start = page.index('      <section className="ops-secondary-cards">', after_layout)
upcoming_start = page.index('      <section className="ops-card ops-upcoming">', secondary_start)
secondary_block = page[secondary_start:upcoming_start].rstrip()
root_close = page.index('\n    </div>\n  );', upcoming_start)
upcoming_block = page[upcoming_start:root_close].rstrip()

replacement = f'''      <section className="ops-dashboard-grid">
        <div className="ops-dashboard-grid__main">
{primary_inner.rstrip()}

{upcoming_block}
        </div>

        <aside className="ops-dashboard-grid__rail">
{support_inner.rstrip()}

{secondary_block}
        </aside>
      </section>'''

page = page[:layout_start] + replacement + page[root_close:]
page_path.write_text(page)

css = css_path.read_text()
overrides = r'''

/* Overview layout and theme polish */
.ops-console {
  gap: 14px;
  max-width: 1280px;
}

.ops-dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(300px, 0.85fr);
  gap: 14px;
  align-items: start;
}

.ops-dashboard-grid__main,
.ops-dashboard-grid__rail {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.ops-dashboard-grid__rail .ops-secondary-cards {
  grid-template-columns: 1fr;
  gap: 14px;
}

.ops-card {
  padding: 16px;
}

.ops-now-playing {
  padding: 18px;
}

.ops-now-playing__content {
  gap: 10px;
  margin-top: 14px;
}

.ops-console__meta strong {
  color: color-mix(in srgb, var(--tc-text-primary) 58%, #d97706 42%);
}

.ops-alert {
  padding: 16px;
  background: linear-gradient(
    100deg,
    color-mix(in srgb, var(--tc-bg-surface) 76%, #ef4444 24%),
    color-mix(in srgb, var(--tc-bg-surface) 92%, #ef4444 8%)
  );
  border-color: color-mix(in srgb, var(--tc-border-default) 45%, #ef4444 55%);
}

.ops-alert--healthy {
  background: linear-gradient(
    100deg,
    color-mix(in srgb, var(--tc-bg-surface) 80%, #10b981 20%),
    color-mix(in srgb, var(--tc-bg-surface) 94%, #10b981 6%)
  );
  border-color: color-mix(in srgb, var(--tc-border-default) 48%, #10b981 52%);
}

.ops-alert__icon {
  color: color-mix(in srgb, var(--tc-text-primary) 55%, #dc2626 45%);
  background: color-mix(in srgb, var(--tc-bg-surface) 65%, #ef4444 35%);
}

.ops-alert--healthy .ops-alert__icon {
  color: color-mix(in srgb, var(--tc-text-primary) 52%, #059669 48%);
  background: color-mix(in srgb, var(--tc-bg-surface) 68%, #10b981 32%);
}

.ops-alert p,
.ops-alert__reported span,
.ops-alert__reported small {
  color: var(--tc-text-secondary);
}

.ops-overflow > summary:hover {
  background: var(--tc-bg-subtle);
}

.ops-status--danger {
  color: color-mix(in srgb, var(--tc-text-primary) 58%, #dc2626 42%);
  background: color-mix(in srgb, var(--tc-bg-surface) 72%, #ef4444 28%);
  border-color: color-mix(in srgb, var(--tc-border-default) 50%, #ef4444 50%);
}

.ops-status--neutral {
  color: var(--tc-text-primary);
  background: var(--tc-bg-subtle);
  border-color: var(--tc-border-default);
}

.ops-status--healthy {
  color: color-mix(in srgb, var(--tc-text-primary) 58%, #059669 42%);
  background: color-mix(in srgb, var(--tc-bg-surface) 75%, #10b981 25%);
  border-color: color-mix(in srgb, var(--tc-border-default) 52%, #10b981 48%);
}

.ops-status--warning {
  color: color-mix(in srgb, var(--tc-text-primary) 58%, #d97706 42%);
  background: color-mix(in srgb, var(--tc-bg-surface) 74%, #f59e0b 26%);
  border-color: color-mix(in srgb, var(--tc-border-default) 52%, #f59e0b 48%);
}

.ops-inline-action,
.ops-card__header > a {
  color: var(--tc-blue-600);
}

.ops-inline-action:hover {
  color: var(--tc-blue-700);
}

.ops-issue-list__icon {
  color: color-mix(in srgb, var(--tc-text-primary) 55%, #dc2626 45%);
  background: color-mix(in srgb, var(--tc-bg-surface) 72%, #ef4444 28%);
}

.ops-update-card--warning {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--tc-bg-surface) 84%, #f59e0b 16%),
    var(--tc-bg-surface) 56%
  );
  border-color: color-mix(in srgb, var(--tc-border-default) 55%, #f59e0b 45%);
}

@media (max-width: 1040px) {
  .ops-dashboard-grid {
    grid-template-columns: 1fr;
  }

  .ops-dashboard-grid__rail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ops-dashboard-grid__rail .ops-secondary-cards {
    display: contents;
  }
}

@media (max-width: 760px) {
  .ops-dashboard-grid__rail {
    grid-template-columns: 1fr;
  }
}
'''

if '/* Overview layout and theme polish */' not in css:
    css += overrides
css_path.write_text(css)
