package com.wakelock.domain.speech

import kotlin.math.max
import kotlin.math.min

/** Sensitivity presets: higher threshold = stricter. */
enum class Sensitivity(val threshold: Double) {
    LENIENT(0.62), NORMAL(0.74), STRICT(0.86);
}

data class MatchResult(
    val score: Double,
    val accepted: Boolean,
    val reason: Reason
) {
    enum class Reason { OK, EMPTY, TOO_SHORT, LOW_SIMILARITY }
}

/**
 * Tolerant speech verification. Pure Kotlin, no Android deps, fully unit-tested.
 *
 * Pipeline: lowercase -> strip punctuation -> expand contractions -> normalise
 * numbers/homophones -> combine token-set ratio + normalised Levenshtein.
 */
object SpeechMatcher {

    private val contractions = mapOf(
        "i'm" to "i am", "im" to "i am", "i'll" to "i will", "ill" to "i will",
        "i've" to "i have", "ive" to "i have", "i'd" to "i would",
        "don't" to "do not", "dont" to "do not", "doesn't" to "does not", "doesnt" to "does not",
        "didn't" to "did not", "didnt" to "did not", "won't" to "will not", "wont" to "will not",
        "can't" to "can not", "cant" to "can not", "cannot" to "can not",
        "isn't" to "is not", "isnt" to "is not", "aren't" to "are not", "arent" to "are not",
        "it's" to "it is", "its" to "it is", "that's" to "that is", "thats" to "that is",
        "let's" to "let us", "lets" to "let us", "i'am" to "i am",
        "there's" to "there is", "theres" to "there is", "what's" to "what is",
        "you're" to "you are", "youre" to "you are", "we're" to "we are", "were" to "we are",
        "they're" to "they are", "theyre" to "they are", "nobody's" to "nobody is",
        "haven't" to "have not", "havent" to "have not", "wasn't" to "was not", "wasnt" to "was not"
    )

    private val homophones = mapOf(
        "to" to "two", "too" to "two", "for" to "four", "fore" to "four",
        "one" to "1", "won" to "1", "ate" to "eight", "know" to "no",
        "right" to "write", "there" to "their", "your" to "you"
    )

    private val fillers = setOf(
        "uh", "um", "erm", "ah", "eh", "like", "okay", "ok", "so", "well", "just", "really"
    )

    fun normalise(raw: String): List<String> {
        var s = raw.lowercase().trim()
        s = s.replace(Regex("[^a-z0-9'\\s]"), " ")
        val expanded = s.split(Regex("\\s+")).filter { it.isNotBlank() }.flatMap { w ->
            (contractions[w] ?: w).split(" ")
        }
        return expanded
            .map { it.replace("'", "") }
            .map { homophones[it] ?: it }
            .filter { it.isNotBlank() && it !in fillers }
    }

    /** Levenshtein distance between two token lists. */
    private fun <T> levenshtein(a: List<T>, b: List<T>): Int {
        if (a.isEmpty()) return b.size
        if (b.isEmpty()) return a.size
        var prev = IntArray(b.size + 1) { it }
        var cur = IntArray(b.size + 1)
        for (i in 1..a.size) {
            cur[0] = i
            for (j in 1..b.size) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                cur[j] = min(min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost)
            }
            val t = prev; prev = cur; cur = t
        }
        return prev[b.size]
    }

    private fun charLevenshteinRatio(a: String, b: String): Double {
        if (a.isEmpty() && b.isEmpty()) return 1.0
        val d = levenshtein(a.toList(), b.toList())
        return 1.0 - d.toDouble() / max(a.length, b.length)
    }

    /** Order-insensitive token overlap (Jaccard-ish, recall-weighted toward the target). */
    private fun tokenSetRatio(target: List<String>, spoken: List<String>): Double {
        if (target.isEmpty()) return 0.0
        val spokenSet = spoken.toMutableList()
        var hits = 0
        for (t in target) {
            // exact or near-miss token match (handles recogniser typos)
            val idx = spokenSet.indexOfFirst { it == t }
            val fuzzyIdx = if (idx >= 0) idx else spokenSet.indexOfFirst {
                it.length > 3 && t.length > 3 && charLevenshteinRatio(it, t) >= 0.75
            }
            if (fuzzyIdx >= 0) { hits++; spokenSet.removeAt(fuzzyIdx) }
        }
        return hits.toDouble() / target.size
    }

    fun score(target: String, spoken: String): Double {
        val t = normalise(target)
        val s = normalise(spoken)
        if (t.isEmpty() || s.isEmpty()) return 0.0

        val setRatio = tokenSetRatio(t, s)
        val seqRatio = 1.0 - levenshtein(t, s).toDouble() / max(t.size, s.size)
        val charRatio = charLevenshteinRatio(t.joinToString(" "), s.joinToString(" "))

        // token coverage dominates (accent/order tolerant), sequence keeps it honest
        return (0.60 * setRatio) + (0.25 * max(0.0, seqRatio)) + (0.15 * max(0.0, charRatio))
    }

    fun verify(target: String, spoken: String, sensitivity: Sensitivity = Sensitivity.NORMAL): MatchResult {
        val sTokens = normalise(spoken)
        if (spoken.isBlank() || sTokens.isEmpty()) {
            return MatchResult(0.0, false, MatchResult.Reason.EMPTY)
        }
        val tTokens = normalise(target)
        // reject trivially short input relative to the target
        if (sTokens.size < max(1, tTokens.size / 3) && sTokens.size < 3) {
            return MatchResult(0.0, false, MatchResult.Reason.TOO_SHORT)
        }
        val sc = score(target, spoken)
        return if (sc >= sensitivity.threshold) {
            MatchResult(sc, true, MatchResult.Reason.OK)
        } else {
            MatchResult(sc, false, MatchResult.Reason.LOW_SIMILARITY)
        }
    }
}
