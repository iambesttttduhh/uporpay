package com.wakelock

import com.wakelock.domain.adaptive.AdaptiveTime
import org.junit.Assert.*
import org.junit.Test

class AdaptiveTimeTest {

    @Test fun not_enough_data_returns_null() {
        assertNull(AdaptiveTime.recommend(listOf(60_000, 70_000), 600, 180, 900))
    }

    @Test fun median_works_for_even_and_odd() {
        assertEquals(2.0, AdaptiveTime.median(listOf(1L, 2L, 3L)), 0.001)
        assertEquals(2.5, AdaptiveTime.median(listOf(1L, 2L, 3L, 4L)), 0.001)
    }

    @Test fun recommendation_never_exceeds_user_max() {
        val slow = List(10) { 20 * 60_000L }   // 20 min each
        val r = AdaptiveTime.recommend(slow, 600, 180, 900)!!
        assertTrue("got $r", r <= 900)
    }

    @Test fun recommendation_never_below_user_min() {
        val fast = List(10) { 5_000L }         // 5s each
        val r = AdaptiveTime.recommend(fast, 600, 300, 900)!!
        assertTrue("got $r", r >= 300)
    }

    @Test fun moves_gradually_not_instantly() {
        val fast = List(10) { 30_000L }        // 30s -> target would be ~60s
        val r = AdaptiveTime.recommend(fast, 900, 60, 900)!!
        assertEquals("should step down by at most one minute", 840L, r)
    }

    @Test fun steps_up_by_at_most_one_minute() {
        val slow = List(10) { 15 * 60_000L }
        val r = AdaptiveTime.recommend(slow, 300, 60, 3600)!!
        assertEquals(360L, r)
    }

    @Test fun applies_safety_margin_above_median() {
        val samples = List(5) { 4 * 60_000L }  // 4 min median
        // target = ceil(4*1.4)=6min=360s, from a current limit of 330 -> steps to 360
        val r = AdaptiveTime.recommend(samples, 330, 60, 3600)!!
        assertTrue(r > 330)
    }
}
