package com.wakelock

import com.wakelock.domain.speech.MatchResult
import com.wakelock.domain.speech.Sensitivity
import com.wakelock.domain.speech.SpeechMatcher
import org.junit.Assert.*
import org.junit.Test

class SpeechMatcherTest {

    private fun ok(target: String, spoken: String, s: Sensitivity = Sensitivity.NORMAL) =
        SpeechMatcher.verify(target, spoken, s).accepted

    @Test fun exact_match_accepted() {
        assertTrue(ok("Today starts now.", "today starts now"))
    }

    @Test fun punctuation_and_case_ignored() {
        assertTrue(ok("Today starts now.", "TODAY, STARTS NOW!"))
    }

    @Test fun contractions_expanded() {
        assertTrue(ok("I am awake and getting out of bed.", "I'm awake and getting out of bed"))
    }

    @Test fun minor_recogniser_typo_accepted() {
        assertTrue(ok("I do what I said I would do.", "I do what I sed I would do"))
    }

    @Test fun filler_words_tolerated() {
        assertTrue(ok("Today starts now.", "um today starts now"))
    }

    @Test fun one_missing_small_word_still_accepted() {
        assertTrue(ok("I am responsible for how I spend this morning.",
            "I am responsible for how I spend morning"))
    }

    @Test fun unrelated_speech_rejected() {
        assertFalse(ok("Today starts now.", "what is the weather in London"))
    }

    @Test fun empty_rejected() {
        val r = SpeechMatcher.verify("Today starts now.", "")
        assertFalse(r.accepted)
        assertEquals(MatchResult.Reason.EMPTY, r.reason)
    }

    @Test fun too_short_rejected() {
        val r = SpeechMatcher.verify("I am responsible for how I spend this morning.", "I")
        assertFalse(r.accepted)
        assertEquals(MatchResult.Reason.TOO_SHORT, r.reason)
    }

    @Test fun single_correct_word_of_long_line_rejected() {
        assertFalse(ok("I am responsible for how I spend this morning.", "morning please stop"))
    }

    @Test fun strict_is_stricter_than_lenient() {
        val spoken = "today start now"
        val target = "Today starts now."
        assertTrue(SpeechMatcher.score(target, spoken) > 0.0)
        val lenient = SpeechMatcher.verify(target, spoken, Sensitivity.LENIENT).accepted
        val strict = SpeechMatcher.verify(target, spoken, Sensitivity.STRICT).accepted
        assertTrue(lenient || !strict)
    }

    @Test fun score_is_bounded() {
        val s = SpeechMatcher.score("Today starts now.", "today starts now")
        assertTrue(s in 0.0..1.0001)
    }
}
