from pathlib import Path
import re

path = Path("apps/dashboard/src/pages/DataSourcesPage.tsx")
text = path.read_text()
pattern = re.compile(
    r'        <aside className="data-source-create-shell__guide">.*?        </aside>',
    re.S,
)
replacement = '''        <aside
          className="data-source-create-shell__guide"
          aria-label="Data Source setup guidance"
        >
          <h3>Setup checklist</h3>
          <ol>
            {copy.steps.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
          <div className="data-source-create-shell__tip">
            <Lightbulb size={17} />
            <div>
              <strong>Good to know</strong>
              <p>{copy.tip}</p>
            </div>
          </div>
          <p className="data-source-create-shell__advanced-note">
            <Check size={15} /> Advanced filtering and cache controls are
            optional.
          </p>
        </aside>'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit("Expected setup guide markup was not found")
text = text.replace(
    "Choose what you are connecting. Each setup page starts with the\n"
    "              essentials and keeps advanced options out of the way.",
    "Choose what you are connecting. Every provider uses the same\n"
    "              compact, predictable setup pattern.",
)
path.write_text(text)
