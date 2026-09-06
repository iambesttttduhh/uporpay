package com.wakelock.ui.onboarding

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wakelock.R
import com.wakelock.ui.theme.WL

private data class Page(val title: String, val body: String, val cta: String, val logo: Boolean = false)

@Composable
fun OnboardingScreen(onDone: () -> Unit) {
    val pages = listOf(
        Page("WAKELOCK", "WAKE UP. TAKE CONTROL.", "GET STARTED", logo = true),
        Page("YOUR ALARM SHOULD REQUIRE ACTION",
            "You decide tonight what your half-asleep self has to do tomorrow. No casual dismiss button.", "NEXT"),
        Page("SPEAK TO WAKE UP",
            "WakeLock gives you random lines to say out loud. Your phone verifies them, so you have to actually wake up.", "NEXT"),
        Page("MAKE IT HARDER",
            "Lockdown Mode is optional and always requires your confirmation. It uses only the restrictions Android legitimately allows.", "NEXT"),
        Page("YOUR MORNING. YOUR RULES.",
            "Choose the number of lines, the time limit, adaptive timing, outside verification and what happens if you fail.",
            "CREATE MY FIRST ALARM")
    )
    var i by remember { mutableIntStateOf(0) }
    val p = pages[i]

    Box(Modifier.fillMaxSize().background(WL.Ink).padding(28.dp)) {
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.weight(1f))
            if (p.logo) {
                Image(painterResource(R.drawable.ic_wakelock_logo), contentDescription = "WakeLock logo",
                    modifier = Modifier.size(140.dp))
                Spacer(Modifier.height(18.dp))
            }
            Text(p.title, fontSize = if (p.logo) 40.sp else 28.sp, fontWeight = FontWeight.Black,
                color = WL.Light, textAlign = TextAlign.Center, letterSpacing = if (p.logo) 4.sp else 0.sp)
            Spacer(Modifier.height(14.dp))
            Text(p.body, color = if (p.logo) WL.Amber else WL.Muted, fontSize = 15.sp,
                textAlign = TextAlign.Center, lineHeight = 22.sp,
                fontWeight = if (p.logo) FontWeight.Bold else FontWeight.Normal)
            Spacer(Modifier.weight(1f))

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                pages.indices.forEach { n ->
                    Box(Modifier.size(if (n == i) 10.dp else 8.dp).clip(CircleShape)
                        .background(if (n == i) WL.Amber else WL.SurfaceAlt))
                }
            }
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = { if (i == pages.lastIndex) onDone() else i++ },
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = WL.ButtonShape,
                colors = ButtonDefaults.buttonColors(containerColor = WL.Amber, contentColor = WL.Ink)
            ) { Text(p.cta, fontWeight = FontWeight.Black) }
            if (i > 0) TextButton(onClick = { i-- }) { Text("Back", color = WL.Muted) }
        }
    }
}
