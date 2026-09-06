package com.wakelock

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.wakelock.ui.MainActivity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Proves the real app process launches, renders and navigates without crashing. */
@RunWith(AndroidJUnit4::class)
class LaunchSmokeTest {

    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @Test fun app_launches_and_shows_onboarding_or_home() {
        rule.waitForIdle()
        // First run shows onboarding; a returning install shows the dashboard.
        val onboarding = rule.onAllNodes(
            androidx.compose.ui.test.hasText("WAKE UP. TAKE CONTROL.")
        ).fetchSemanticsNodes().isNotEmpty()
        val home = rule.onAllNodes(
            androidx.compose.ui.test.hasText("WAKELOCK")
        ).fetchSemanticsNodes().isNotEmpty()
        assert(onboarding || home) { "neither onboarding nor home rendered" }
    }

    @Test fun onboarding_can_be_completed_to_alarm_editor() {
        rule.waitForIdle()
        // Walk the onboarding CTAs if present.
        listOf("GET STARTED", "NEXT", "NEXT", "NEXT", "CREATE MY FIRST ALARM").forEach { label ->
            val nodes = rule.onAllNodes(androidx.compose.ui.test.hasText(label)).fetchSemanticsNodes()
            if (nodes.isNotEmpty()) {
                rule.onNodeWithText(label).performClick()
                rule.waitForIdle()
            }
        }
        // We should now be somewhere real: the editor or the dashboard.
        val editor = rule.onAllNodes(androidx.compose.ui.test.hasText("NEW ALARM"))
            .fetchSemanticsNodes().isNotEmpty()
        val home = rule.onAllNodes(androidx.compose.ui.test.hasText("ADD ALARM"))
            .fetchSemanticsNodes().isNotEmpty()
        assert(editor || home) { "onboarding did not lead to a functional screen" }
    }
}
