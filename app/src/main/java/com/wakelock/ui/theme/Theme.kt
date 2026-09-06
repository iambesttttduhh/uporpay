package com.wakelock.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object WL {
    val Ink = Color(0xFF0B0D12)
    val Surface = Color(0xFF14171F)
    val SurfaceAlt = Color(0xFF1C212C)
    val Amber = Color(0xFFFFB020)
    val Orange = Color(0xFFFF7A18)
    val Red = Color(0xFFFF3B30)
    val Light = Color(0xFFF5F6F8)
    val Success = Color(0xFF34C77B)
    val Muted = Color(0xFF8A93A6)

    val CardShape = RoundedCornerShape(20.dp)
    val ButtonShape = RoundedCornerShape(16.dp)
}

private val DarkScheme = darkColorScheme(
    primary = WL.Amber, onPrimary = WL.Ink,
    secondary = WL.Orange, onSecondary = WL.Ink,
    background = WL.Ink, onBackground = WL.Light,
    surface = WL.Surface, onSurface = WL.Light,
    surfaceVariant = WL.SurfaceAlt, onSurfaceVariant = WL.Muted,
    error = WL.Red, onError = WL.Light
)

private val LightScheme = lightColorScheme(
    primary = Color(0xFFB86A00), onPrimary = Color.White,
    secondary = WL.Orange, onSecondary = Color.White,
    background = Color(0xFFFAFAFB), onBackground = Color(0xFF14171F),
    surface = Color.White, onSurface = Color(0xFF14171F),
    surfaceVariant = Color(0xFFEEF0F4), onSurfaceVariant = Color(0xFF5A6274),
    error = WL.Red, onError = Color.White
)

private val Typo = Typography(
    displayLarge = Typography().displayLarge.copy(fontWeight = FontWeight.Black, letterSpacing = (-1).sp),
    headlineMedium = Typography().headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
    titleLarge = Typography().titleLarge.copy(fontWeight = FontWeight.Bold),
    labelLarge = Typography().labelLarge.copy(fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
)

@Composable
fun WakeLockTheme(themePref: String = "SYSTEM", content: @Composable () -> Unit) {
    val dark = when (themePref) {
        "LIGHT" -> false
        "DARK" -> true
        else -> isSystemInDarkTheme()
    }
    MaterialTheme(
        colorScheme = if (dark) DarkScheme else LightScheme,
        typography = Typo,
        content = content
    )
}
