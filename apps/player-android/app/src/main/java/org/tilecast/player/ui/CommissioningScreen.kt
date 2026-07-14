package org.tilecast.player.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.tilecast.player.reliability.CommissioningStatus
import org.tilecast.player.reliability.CommissioningStep
import org.tilecast.player.ui.theme.SignalBlue
import org.tilecast.player.ui.theme.SignalButton
import org.tilecast.player.ui.theme.SignalMuted
import org.tilecast.player.ui.theme.SignalOutlinedButton
import org.tilecast.player.ui.theme.SignalText
import org.tilecast.player.ui.theme.SignalWarning

@Composable
fun CommissioningScreen(
    state: CommissioningStatus,
    setPin: (CharArray) -> Unit,
    openAccessibility: () -> Unit,
    openInstallPermission: () -> Unit,
    refresh: () -> Unit,
    advance: () -> Unit,
    runSelfTest: () -> Unit,
    finish: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = 80.dp, vertical = 54.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(Modifier.fillMaxWidth(.82f)) {
            Text("Harden this player", color = SignalText, fontSize = 42.sp, fontWeight = FontWeight.SemiBold)
            Text("Commissioning verifies local Android capabilities before unattended playback.", color = SignalMuted, fontSize = 20.sp)
            Spacer(Modifier.height(28.dp))
            Text("Step ${state.step.ordinal + 1} of ${CommissioningStep.entries.size}", color = SignalBlue, fontSize = 16.sp)
            Spacer(Modifier.height(12.dp))
            CommissioningStepBody(state, setPin, openAccessibility, openInstallPermission, refresh, runSelfTest)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            when (state.step) {
                CommissioningStep.RESULT -> SignalButton(onClick = finish) { Text("Finish commissioning") }
                CommissioningStep.ADMIN_PIN -> if (state.adminPinSet) SignalButton(onClick = advance) { Text("Continue") }
                CommissioningStep.ACCESSIBILITY -> SignalButton(onClick = advance, enabled = state.accessibilityEnabled) { Text("Continue") }
                CommissioningStep.INSTALL_PERMISSION -> SignalButton(onClick = advance, enabled = state.installPermissionGranted) { Text("Continue") }
                CommissioningStep.BOOT_RECOVERY -> SignalButton(onClick = advance, enabled = state.bootLaunchVerified) { Text("Continue") }
                CommissioningStep.PRESENTATION -> SignalButton(onClick = advance, enabled = state.immersiveVerified && state.keepAwakeVerified) { Text("Continue") }
                CommissioningStep.CACHED_FALLBACK -> SignalButton(onClick = advance, enabled = state.cachedFallbackAvailable) { Text("Continue") }
                CommissioningStep.SELF_TEST -> SignalButton(onClick = advance, enabled = state.selfTestResult != null) { Text("View result") }
                else -> SignalButton(onClick = advance) { Text("Continue") }
            }
        }
    }
}

@Composable
private fun CommissioningStepBody(
    state: CommissioningStatus,
    setPin: (CharArray) -> Unit,
    openAccessibility: () -> Unit,
    openInstallPermission: () -> Unit,
    refresh: () -> Unit,
    runSelfTest: () -> Unit,
) {
    when (state.step) {
        CommissioningStep.ADMIN_PIN -> {
            var pin by remember { mutableStateOf("") }
            Text("Set a local administrator PIN", color = SignalText, fontSize = 30.sp)
            Text("The PIN opens only Tilecast’s bounded local maintenance tools and is stored as a secure hash.", color = SignalMuted, fontSize = 18.sp)
            Spacer(Modifier.height(18.dp))
            OutlinedTextField(
                value = pin,
                onValueChange = { pin = it.filter(Char::isDigit).take(12) },
                label = { Text("4–12 digit PIN") },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                singleLine = true,
            )
            Spacer(Modifier.height(12.dp))
            SignalButton(onClick = { setPin(pin.toCharArray()); pin = "" }, enabled = pin.length >= 4) { Text(if (state.adminPinSet) "Replace PIN" else "Set PIN") }
        }
        CommissioningStep.ACCESSIBILITY -> CapabilityStep(
            "Enable Accessibility Control",
            "Tilecast uses its disclosed accessibility service only to detect an unexpected foreground app, return to playback, and request Android’s lock action. It cannot approve dialogs or click settings.",
            state.accessibilityEnabled,
            "Open Accessibility Settings",
            openAccessibility,
            refresh,
        )
        CommissioningStep.INSTALL_PERMISSION -> CapabilityStep(
            "Allow signed Player updates",
            "Android requires local approval before Tilecast may open its signed APK in the system installer. Tilecast never approves the installer prompt for you.",
            state.installPermissionGranted,
            "Open install permission",
            openInstallPermission,
            refresh,
        )
        CommissioningStep.BOOT_RECOVERY -> CapabilityStep(
            "Verify launch after boot",
            "Restart the device once. Tilecast records the boot broadcast, bounded launch attempts, and a healthy foreground return. A firmware-blocked launch remains visible as not verified.",
            state.bootLaunchVerified,
            "Check boot result",
            refresh,
            refresh,
        )
        CommissioningStep.PRESENTATION -> {
            Text("Verify fullscreen presentation", color = SignalText, fontSize = 30.sp)
            StatusLine("Immersive mode", state.immersiveVerified)
            StatusLine("Keep screen awake", state.keepAwakeVerified)
            SignalOutlinedButton(onClick = refresh) { Text("Verify again") }
        }
        CommissioningStep.CACHED_FALLBACK -> {
            Text("Verify cached fallback content", color = SignalText, fontSize = 30.sp)
            Text("Tilecast protects the active cached manifest and required files so playback continues when the server is unavailable.", color = SignalMuted, fontSize = 18.sp)
            StatusLine("Cached fallback", state.cachedFallbackAvailable)
            if (!state.cachedFallbackAvailable) Text("Assign downloadable fallback content in Studio, then synchronize this player.", color = SignalWarning, fontSize = 17.sp)
            SignalOutlinedButton(onClick = refresh) { Text("Check cached content") }
        }
        CommissioningStep.SELF_TEST -> {
            Text("Run unattended-readiness test", color = SignalText, fontSize = 30.sp)
            Text("The test checks the PIN, protected Android permissions, boot evidence, cached fallback, and current recovery state without changing system settings.", color = SignalMuted, fontSize = 18.sp)
            state.selfTestResult?.let { Text(it.replace('_', ' '), color = if (it == "passed") SignalBlue else SignalWarning, fontSize = 20.sp) }
            Spacer(Modifier.height(14.dp))
            SignalButton(onClick = runSelfTest) { Text("Run self-test") }
        }
        CommissioningStep.RESULT -> {
            Text("Zero-Touch Readiness", color = SignalText, fontSize = 30.sp)
            Text(state.readiness.replace('_', ' '), color = if (state.readiness == "ready") SignalBlue else SignalWarning, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            Text("Ready means all locally verifiable safeguards passed. Partial readiness remains explicit in Studio and does not claim recovery from power, network-credential, hardware, or Android approval failures.", color = SignalMuted, fontSize = 18.sp)
        }
    }
}

@Composable
private fun CapabilityStep(title: String, description: String, verified: Boolean, action: String, open: () -> Unit, refresh: () -> Unit) {
    Text(title, color = SignalText, fontSize = 30.sp)
    Text(description, color = SignalMuted, fontSize = 18.sp)
    StatusLine("Verification", verified)
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        SignalButton(onClick = open) { Text(action) }
        SignalOutlinedButton(onClick = refresh) { Text("Verify again") }
    }
}

@Composable
private fun StatusLine(label: String, verified: Boolean) {
    Text("$label: ${if (verified) "Verified" else "Not verified"}", color = if (verified) SignalBlue else SignalWarning, fontSize = 19.sp, modifier = Modifier.padding(vertical = 12.dp))
}
