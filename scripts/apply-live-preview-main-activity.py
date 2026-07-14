from pathlib import Path

path = Path("apps/player-android/app/src/main/java/org/tilecast/player/MainActivity.kt")
source = path.read_text()


def replace_once(old: str, new: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"expected one MainActivity marker, found {count}: {old[:80]!r}")
    source = source.replace(old, new, 1)


replace_once(
    "import org.tilecast.player.content.FullscreenPlayback\n",
    "import org.tilecast.player.content.FullscreenPlayback\n"
    "import org.tilecast.player.preview.LivePreviewCoordinator\n",
)
replace_once(
    "\tprivate lateinit var reliability:ReliabilityController\n",
    "\tprivate lateinit var reliability:ReliabilityController\n"
    "\tprivate lateinit var livePreview:LivePreviewCoordinator\n",
)
replace_once(
    "\t\treliability=ReliabilityController(this)\n",
    "\t\treliability=ReliabilityController(this)\n"
    "\t\tlivePreview=LivePreviewCoordinator(this,::previewCaptureBlockReason)\n",
)
replace_once(
    "override fun onStart(){super.onStart();",
    "override fun onStart(){super.onStart();livePreview.start();",
)
replace_once(
    "override fun onStop(){getSharedPreferences",
    "override fun onStop(){livePreview.stop();getSharedPreferences",
)
replace_once(
    "    override fun onWindowFocusChanged",
    "    override fun onDestroy(){livePreview.close();super.onDestroy()}\n"
    "    override fun onWindowFocusChanged",
)
replace_once(
    "\tfun maintenanceChanged(){model.playerConfig.value?.let{applyReliability(it,model.activeHours.value)}}\n",
    "\tfun maintenanceChanged(){model.playerConfig.value?.let{applyReliability(it,model.activeHours.value)}}\n"
    "\tprivate fun previewCaptureBlockReason():String?=when{\n"
    "\t\tadminPrompt->\"sensitive_admin\"\n"
    "\t\treliability.maintenanceUntil()!=null->\"sensitive_maintenance\"\n"
    "\t\tmodel.commissioning.value.required->\"sensitive_commissioning\"\n"
    "\t\tmodel.update.value?.state in setOf(\"waiting_for_permission\",\"waiting_for_user\",\"installing\")->\"sensitive_update\"\n"
    "\t\tmodel.identify.value!=null->\"sensitive_identify\"\n"
    "\t\tmodel.state.value !is PlayerState.PairedIdle->\"sensitive_pairing\"\n"
    "\t\telse->null\n"
    "\t}\n",
)

path.write_text(source)
