from pathlib import Path

screens = Path('apps/dashboard/src/pages/ScreensPage.tsx')
text = screens.read_text()
old = '''              <div className="heading-actions">
                <button
                  className="button button--quiet"
                  onClick={() =>
                    command.mutate({ type: "power_assist_sleep", payload: {} })
                  }
                >
                  Test device sleep
                </button>
                <button
                  className="button button--quiet"
                  onClick={() =>
                    command.mutate({ type: "power_assist_wake", payload: {} })
                  }
                >
                  Test device wake
                </button>
                <button
                  className="button button--quiet"
                  onClick={() =>
                    command.mutate({
                      type: "retry_player_recovery",
                      payload: {},
                    })
                  }
                >
                  Retry recovery
                </button>
                <button
                  className="button button--quiet"
                  disabled={!reliability.data?.safeMode}
                  onClick={() =>
                    command.mutate({ type: "exit_safe_mode", payload: {} })
                  }
                >
                  Exit safe mode
                </button>
                {(
                  [
                    ["retry_current_item", "Retry current item"],
                    ["skip_current_item", "Skip current item"],
                    ["recreate_renderer", "Recreate renderer"],
                    ["recreate_playback_session", "Recreate playback session"],
                    ["restart_activity", "Restart activity"],
                    ["restart_player_process", "Restart player process"],
                    ["resynchronize_player", "Resynchronize player"],
                    ["run_player_self_test", "Run player self-test"],
                  ] as const
                ).map(([type, label]) => (
                  <button
                    key={type}
                    className="button button--quiet"
                    disabled={command.isPending}
                    onClick={() => command.mutate({ type, payload: {} })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <h4>Power Assist test confirmation</h4>
              <p>
                Confirm physical TV behavior separately; Tilecast cannot infer
                TV standby, wake, or input selection from process activity.
              </p>
              <div className="policy-grid">
                {(
                  [
                    "deviceSleep",
                    "tvStandby",
                    "deviceWake",
                    "tvWake",
                    "inputSelection",
                    "tilecastStartup",
                  ] as const
                ).map((key) => (
                  <label key={key}>
                    {key.replace(/([A-Z])/g, " $1")}
                    <select
                      value={powerResults[key]}
                      onChange={(event) =>
                        setPowerResults({
                          ...powerResults,
                          [key]: event.target.value,
                        })
                      }
                    >
                      {[
                        "untested",
                        "confirmed_working",
                        "partially_working",
                        "failed",
                        "unsupported",
                      ].map((value) => (
                        <option key={value} value={value}>
                          {value.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <button
                className="button button--primary"
                onClick={() => savePowerResults.mutate()}
                disabled={savePowerResults.isPending}
              >
                Save test confirmation
              </button>'''
new = '''              <section className="reliability-controls" aria-labelledby="reliability-controls-title">
                <header className="reliability-section-heading">
                  <div>
                    <h4 id="reliability-controls-title">Player controls</h4>
                    <p>Run a focused recovery action without leaving this screen.</p>
                  </div>
                  {command.isPending && <span className="status-badge">Sending…</span>}
                </header>
                <div className="reliability-control-groups">
                  <div className="reliability-control-group">
                    <div>
                      <h5>Power Assist</h5>
                      <p>Test Android sleep and wake behavior.</p>
                    </div>
                    <div className="reliability-button-grid">
                      <button
                        className="button button--secondary"
                        disabled={command.isPending}
                        onClick={() =>
                          command.mutate({ type: "power_assist_sleep", payload: {} })
                        }
                      >
                        Test sleep
                      </button>
                      <button
                        className="button button--secondary"
                        disabled={command.isPending}
                        onClick={() =>
                          command.mutate({ type: "power_assist_wake", payload: {} })
                        }
                      >
                        Test wake
                      </button>
                    </div>
                  </div>
                  <div className="reliability-control-group">
                    <div>
                      <h5>Recovery</h5>
                      <p>Retry recovery or leave safe mode after resolving a fault.</p>
                    </div>
                    <div className="reliability-button-grid">
                      <button
                        className="button button--secondary"
                        disabled={command.isPending}
                        onClick={() =>
                          command.mutate({ type: "retry_player_recovery", payload: {} })
                        }
                      >
                        Retry recovery
                      </button>
                      <button
                        className="button button--secondary"
                        disabled={command.isPending || !reliability.data?.safeMode}
                        onClick={() =>
                          command.mutate({ type: "exit_safe_mode", payload: {} })
                        }
                      >
                        Exit safe mode
                      </button>
                    </div>
                  </div>
                  <div className="reliability-control-group reliability-control-group--wide">
                    <div>
                      <h5>Playback and player</h5>
                      <p>Use the least disruptive action that matches the problem.</p>
                    </div>
                    <div className="reliability-button-grid reliability-button-grid--wide">
                      {(
                        [
                          ["retry_current_item", "Retry item"],
                          ["skip_current_item", "Skip item"],
                          ["recreate_renderer", "Recreate renderer"],
                          ["recreate_playback_session", "Recreate session"],
                          ["restart_activity", "Restart activity"],
                          ["restart_player_process", "Restart player"],
                          ["resynchronize_player", "Resynchronize"],
                          ["run_player_self_test", "Run self-test"],
                        ] as const
                      ).map(([type, label]) => (
                        <button
                          key={type}
                          className="button button--secondary"
                          disabled={command.isPending}
                          onClick={() => command.mutate({ type, payload: {} })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
              <section className="power-assist-confirmation" aria-labelledby="power-assist-confirmation-title">
                <header className="reliability-section-heading">
                  <div>
                    <h4 id="power-assist-confirmation-title">Power Assist verification</h4>
                    <p>Record what happened on the physical display after running the tests above.</p>
                  </div>
                  <span className="status-badge">Manual check</span>
                </header>
                <div className="power-assist-grid">
                  {(
                    [
                      ["deviceSleep", "Device sleep", "Did Android enter its requested sleep state?"],
                      ["tvStandby", "TV standby", "Did the television actually enter standby?"],
                      ["deviceWake", "Device wake", "Did Android wake and resume Tilecast?"],
                      ["tvWake", "TV wake", "Did the television power back on?"],
                      ["inputSelection", "Input selection", "Did the television return to the Tilecast input?"],
                      ["tilecastStartup", "Tilecast startup", "Did playback return without local intervention?"],
                    ] as const
                  ).map(([key, label, description]) => (
                    <label className="power-assist-field" key={key}>
                      <span>{label}</span>
                      <small>{description}</small>
                      <select
                        value={powerResults[key]}
                        onChange={(event) =>
                          setPowerResults({
                            ...powerResults,
                            [key]: event.target.value,
                          })
                        }
                      >
                        {[
                          "untested",
                          "confirmed_working",
                          "partially_working",
                          "failed",
                          "unsupported",
                        ].map((value) => (
                          <option key={value} value={value}>
                            {value.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <footer className="power-assist-confirmation__footer">
                  <p>Tilecast cannot infer TV standby, wake, or input selection from app activity alone.</p>
                  <button
                    className="button button--primary"
                    onClick={() => savePowerResults.mutate()}
                    disabled={savePowerResults.isPending}
                  >
                    {savePowerResults.isPending ? "Saving…" : "Save verification"}
                  </button>
                </footer>
              </section>'''
if old not in text:
    raise SystemExit('reliability block not found')
screens.write_text(text.replace(old, new, 1))

styles = Path('apps/dashboard/src/styles/signal.css')
css = styles.read_text()
css += '''\n\n/* Screen reliability controls */\n.reliability-controls,\n.power-assist-confirmation {\n  margin-top: var(--tc-space-5);\n  overflow: hidden;\n  background: var(--tc-bg-surface);\n  border: 1px solid var(--tc-border-default);\n  border-radius: var(--tc-radius-panel);\n}\n.reliability-section-heading {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: var(--tc-space-4);\n  padding: var(--tc-space-5);\n  border-bottom: 1px solid var(--tc-border-default);\n}\n.reliability-section-heading h4,\n.reliability-control-group h5 {\n  margin: 0;\n}\n.reliability-section-heading p,\n.reliability-control-group p {\n  margin: var(--tc-space-1) 0 0;\n  color: var(--tc-text-secondary);\n}\n.reliability-control-groups {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n}\n.reliability-control-group {\n  display: grid;\n  align-content: start;\n  gap: var(--tc-space-4);\n  padding: var(--tc-space-5);\n  border-right: 1px solid var(--tc-border-default);\n  border-bottom: 1px solid var(--tc-border-default);\n}\n.reliability-control-group:nth-child(2) {\n  border-right: 0;\n}\n.reliability-control-group--wide {\n  grid-column: 1 / -1;\n  border-right: 0;\n  border-bottom: 0;\n}\n.reliability-button-grid {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: var(--tc-space-2);\n}\n.reliability-button-grid--wide {\n  grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));\n}\n.reliability-button-grid .button {\n  justify-content: flex-start;\n  width: 100%;\n  min-width: 0;\n  text-align: left;\n}\n.power-assist-grid {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 0;\n}\n.power-assist-field {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) minmax(150px, 0.72fr);\n  gap: var(--tc-space-1) var(--tc-space-4);\n  align-items: center;\n  padding: var(--tc-space-4) var(--tc-space-5);\n  border-right: 1px solid var(--tc-border-default);\n  border-bottom: 1px solid var(--tc-border-default);\n}\n.power-assist-field:nth-child(even) {\n  border-right: 0;\n}\n.power-assist-field:nth-last-child(-n + 2) {\n  border-bottom: 0;\n}\n.power-assist-field > span {\n  font: var(--tc-text-label);\n}\n.power-assist-field small {\n  grid-column: 1;\n  color: var(--tc-text-secondary);\n  font: var(--tc-text-supporting);\n}\n.power-assist-field select {\n  grid-column: 2;\n  grid-row: 1 / span 2;\n  width: 100%;\n}\n.power-assist-confirmation__footer {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: var(--tc-space-4);\n  padding: var(--tc-space-4) var(--tc-space-5);\n  background: var(--tc-bg-subtle);\n  border-top: 1px solid var(--tc-border-default);\n}\n.power-assist-confirmation__footer p {\n  margin: 0;\n  color: var(--tc-text-secondary);\n  font: var(--tc-text-supporting);\n}\n@media (max-width: 850px) {\n  .reliability-control-groups,\n  .power-assist-grid {\n    grid-template-columns: 1fr;\n  }\n  .reliability-control-group,\n  .power-assist-field {\n    border-right: 0;\n    border-bottom: 1px solid var(--tc-border-default);\n  }\n  .power-assist-field:nth-last-child(-n + 2) {\n    border-bottom: 1px solid var(--tc-border-default);\n  }\n  .power-assist-field:last-child {\n    border-bottom: 0;\n  }\n}\n@media (max-width: 580px) {\n  .reliability-button-grid,\n  .reliability-button-grid--wide,\n  .power-assist-field {\n    grid-template-columns: 1fr;\n  }\n  .power-assist-field select,\n  .power-assist-field small {\n    grid-column: 1;\n    grid-row: auto;\n  }\n  .power-assist-confirmation__footer {\n    align-items: stretch;\n    flex-direction: column;\n  }\n}\n'''
styles.write_text(css)

youtube = Path('apps/player-android/app/src/main/java/org/tilecast/player/content/YouTubePlayback.kt')
yt = youtube.read_text()
yt = yt.replace(
    'private class YouTubeChromeClient(private val container: FrameLayout) : WebChromeClient() {\n    private var fullscreenView: View? = null',
    'private class YouTubeChromeClient(private val container: FrameLayout) : WebChromeClient() {\n    private var webView: WebView? = null\n    private var fullscreenView: View? = null',
    1,
)
yt = yt.replace(
    '    override fun onShowCustomView(view: View, callback: CustomViewCallback) {',
    '    fun attach(webView: WebView) {\n        this.webView = webView\n    }\n\n    override fun onShowCustomView(view: View, callback: CustomViewCallback) {',
    1,
)
yt = yt.replace(
    '        fullscreenView = view\n        fullscreenCallback = callback',
    '        fullscreenView = view\n        fullscreenCallback = callback\n        webView?.visibility = View.INVISIBLE',
    1,
)
yt = yt.replace(
    '        fullscreenView = null\n        fullscreenCallback?.onCustomViewHidden()',
    '        fullscreenView = null\n        webView?.visibility = View.VISIBLE\n        fullscreenCallback?.onCustomViewHidden()',
    1,
)
yt = yt.replace(
    '                        loadDataWithBaseURL("$origin/", html, "text/html", "UTF-8", null)\n                    }\n                addView(webView)',
    '                        loadDataWithBaseURL("$origin/", html, "text/html", "UTF-8", null)\n                    }\n                chrome.attach(webView)\n                addView(webView)',
    1,
)
yt = yt.replace('playsinline:0,controls:', 'playsinline:1,controls:', 1)
youtube.write_text(yt)

manifest = Path('apps/player-android/app/src/main/AndroidManifest.xml')
mt = manifest.read_text()
mt = mt.replace('android:icon="@drawable/tilecast_icon"\n        android:label=', 'android:hardwareAccelerated="true"\n        android:icon="@drawable/tilecast_icon"\n        android:label=', 1)
manifest.write_text(mt)
