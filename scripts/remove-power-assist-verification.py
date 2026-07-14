from pathlib import Path

path = Path("apps/dashboard/src/pages/ScreensPage.tsx")
text = path.read_text()

text = text.replace("  PowerAssistResults,\n", "", 1)

state_start = text.index("  const [powerResults, setPowerResults] = useState<PowerAssistResults>({")
state_end = text.index("  const command = useMutation({", state_start)
text = text[:state_start] + text[state_end:]

section_start = text.index('              <section\n                className="power-assist-confirmation"')
section_end = text.index("              </section>", section_start) + len("              </section>\n")
text = text[:section_start] + text[section_end:]

path.write_text(text)
