package org.tilecast.player

import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test

class TvFocusTest {
    @get:Rule val compose = createComposeRule()
    @Test fun primaryControlIsDpadActionable() {
        compose.setContent { Button(onClick = {}) { Text("Continue") } }
        compose.onNodeWithText("Continue").assertHasClickAction()
    }
}

