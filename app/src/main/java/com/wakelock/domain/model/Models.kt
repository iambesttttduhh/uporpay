package com.wakelock.domain.model

enum class ChallengeType(val label: String, val lines: Int) {
    QUICK("Quick", 3), STANDARD("Standard", 5), HARD("Hard", 7),
    EXTREME("Extreme", 10), CUSTOM("Custom", 5)
}

enum class FailureAction(val label: String) {
    KEEP_TRYING("Keep trying"),
    NEW_CHALLENGE("New challenge"),
    HARDER_CHALLENGE("Harder challenge"),
    OUTSIDE_MODE("Outside mode"),
    LOCKDOWN("Lockdown")
}

enum class VibrationPattern(val label: String) { GENTLE("Gentle"), STRONG("Strong"), PULSING("Pulsing") }

enum class AlarmState {
    IDLE, SCHEDULED, TRIGGERING, ACTIVE, CHALLENGE_STARTED, SPEAKING, VERIFYING,
    LINE_COMPLETED, CHALLENGE_COMPLETED, SNOOZED, TIME_WARNING, FAILED,
    LOCKDOWN, RECOVERY, OUTSIDE_PENDING, OUTSIDE_VERIFIED, COMPLETED
}

enum class SessionResult { PENDING, SUCCESS, FAILED, CANCELLED }

enum class LineCategory {
    SHORT, DISCIPLINE, MORNING, PRODUCTIVITY, FITNESS, STUDY, WORK,
    CONFIDENCE, CALM, INTENSE, FUNNY, WAKEUP
}
