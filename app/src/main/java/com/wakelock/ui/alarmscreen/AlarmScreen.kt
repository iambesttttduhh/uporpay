package com.wakelock.ui.alarmscreen

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wakelock.domain.model.AlarmState
import com.wakelock.domain.speech.SpeechMatcher
import com.wakelock.domain.speech.Sensitivity
import com.wakelock.service.AlarmForegroundService
import com.wakelock.speech.SpeechClient
import com.wakelock.speech.SpeechStatus
import com.wakelock.ui.theme.WL
import com.wakelock.util.ScheduleMath
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun AlarmScreen(onFinished: () -> Unit) {
    val ctx = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val st by AlarmForegroundService.state.collectAsStateWithLifecycle()

    var status by remember { mutableStateOf(SpeechStatus.IDLE) }
    var heard by remember { mutableStateOf("") }
    var level by remember { mutableFloatStateOf(0f) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var showOutside by remember { mutableStateOf(false) }
    var showExit by remember { mutableStateOf(false) }

    val speech = remember { SpeechClient(ctx) }
    DisposableEffect(Unit) { onDispose { speech.destroy() } }

    LaunchedEffect(st.finished) { if (st.finished) { /* completion screen shown below */ } }

    val session = st.session
    val total = st.lines.size
    val idx = session?.currentIndex ?: 0
    val currentLine = st.lines.getOrNull(idx)

    // ---------- completion / failure terminal states ----------
    if (st.finished) {
        TerminalScreen(
            success = st.success,
            message = st.message,
            completionMs = session?.let { (it.completedAt ?: System.currentTimeMillis()) - it.startedAt } ?: 0,
            lines = total,
            onDone = onFinished
        )
        return
    }

    if (!st.active) { LaunchedEffect(Unit) { onFinished() }; return }

    // ---------- outside mode gate ----------
    if (st.state == AlarmState.OUTSIDE_PENDING) {
        com.wakelock.ui.outside.OutsideScreen(
            onVerified = { AlarmForegroundService.state.value.let { } }
        )
        return
    }

    val pctLeft = (st.remainingMs.toFloat() / st.totalMs.toFloat()).coerceIn(0f, 1f)
    val urgent = pctLeft <= 0.10f
    val bg by animateColorAsState(
        if (urgent) Color(0xFF2A0B0B) else WL.Ink, tween(600), label = "bg"
    )

    val infinite = rememberInfiniteTransition(label = "pulse")
    val pulse by infinite.animateFloat(
        1f, if (status == SpeechStatus.LISTENING) 1.14f else 1.06f,
        infiniteRepeatable(tween(if (urgent) 500 else 1100), RepeatMode.Reverse), label = "p"
    )

    fun startListening() {
        val target = currentLine ?: return
        errorMsg = null; heard = ""; status = SpeechStatus.LISTENING
        haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress)
        speech.start(
            onPartial = { heard = it },
            onResult = { text ->
                heard = text
                status = SpeechStatus.CHECKING
                val sens = runCatching {
                    Sensitivity.valueOf(st.alarm?.sensitivity ?: "NORMAL")
                }.getOrDefault(Sensitivity.NORMAL)
                val res = SpeechMatcher.verify(target, text, sens)
                if (res.accepted) {
                    status = SpeechStatus.VERIFIED
                    haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress)
                } else {
                    status = SpeechStatus.TRY_AGAIN
                    errorMsg = when (res.reason) {
                        com.wakelock.domain.speech.MatchResult.Reason.EMPTY -> "I didn't hear anything."
                        com.wakelock.domain.speech.MatchResult.Reason.TOO_SHORT -> "That was too short. Say the whole line."
                        else -> "That didn't match. Try again."
                    }
                }
                (ctx as? android.app.Activity)?.let { }
                AlarmForegroundService.state.value.let { }
                serviceSubmit(res.accepted, text, res.score)
            },
            onError = { msg ->
                status = SpeechStatus.TRY_AGAIN
                errorMsg = msg
            },
            onLevel = { level = it }
        )
    }

    Box(
        Modifier.fillMaxSize().background(bg).padding(20.dp),
        contentAlignment = Alignment.TopCenter
    ) {
        Column(
            Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(8.dp))
            Text(
                SimpleDateFormat("h:mm", Locale.getDefault()).format(Date()),
                fontSize = 62.sp, fontWeight = FontWeight.Black, color = WL.Light
            )
            Text(
                "WAKE UP",
                fontSize = 30.sp, fontWeight = FontWeight.Black,
                color = if (urgent) WL.Red else WL.Amber, letterSpacing = 4.sp
            )
            Text(
                (st.alarm?.name ?: "Morning Challenge").uppercase(),
                color = WL.Muted, fontSize = 13.sp, letterSpacing = 2.sp
            )

            Spacer(Modifier.height(18.dp))
            Text(
                "LINE ${(idx + 1).coerceAtMost(total)} / $total",
                color = WL.Muted, fontSize = 14.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp
            )
            Spacer(Modifier.height(10.dp))

            Surface(
                color = WL.Surface, shape = WL.CardShape,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    "\u201C${currentLine ?: "…"}\u201D",
                    Modifier.padding(20.dp).fillMaxWidth(),
                    color = WL.Light, fontSize = 24.sp, fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center, lineHeight = 32.sp
                )
            }

            Spacer(Modifier.height(14.dp))
            ProgressDots(total = total, done = idx)

            Spacer(Modifier.height(10.dp))
            val statusText = when (status) {
                SpeechStatus.LISTENING -> "LISTENING"
                SpeechStatus.CHECKING -> "CHECKING"
                SpeechStatus.VERIFIED -> "✓ VERIFIED"
                SpeechStatus.TRY_AGAIN -> "TRY AGAIN"
                SpeechStatus.UNAVAILABLE -> "SPEECH UNAVAILABLE"
                else -> " "
            }
            Text(
                statusText,
                color = when (status) {
                    SpeechStatus.VERIFIED -> WL.Success
                    SpeechStatus.TRY_AGAIN, SpeechStatus.UNAVAILABLE -> WL.Red
                    else -> WL.Amber
                },
                fontWeight = FontWeight.Black, fontSize = 16.sp, letterSpacing = 2.sp
            )
            if (heard.isNotBlank()) {
                Text("heard: $heard", color = WL.Muted, fontSize = 12.sp,
                    textAlign = TextAlign.Center, maxLines = 2)
            }
            errorMsg?.let {
                Text(it, color = WL.Red.copy(alpha = .9f), fontSize = 13.sp, textAlign = TextAlign.Center)
            }
            st.message?.let {
                Text(it, color = WL.Orange, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
            }

            Spacer(Modifier.weight(1f))

            // ---- microphone ----
            Box(
                Modifier
                    .size(180.dp)
                    .scale(if (status == SpeechStatus.LISTENING) pulse else 1f)
                    .clip(CircleShape)
                    .background(
                        if (status == SpeechStatus.LISTENING) WL.Amber
                        else if (urgent) WL.Red else WL.Orange
                    )
                    .semantics { contentDescription = "Hold to speak the required line" }
                    .pointerInput(currentLine, status) {
                        detectTapGestures(
                            onPress = {
                                startListening()
                                tryAwaitRelease()
                                speech.stopListening()
                            }
                        )
                    },
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("🎙", fontSize = 46.sp)
                    Text("HOLD TO SPEAK", color = WL.Ink, fontWeight = FontWeight.Black, fontSize = 13.sp)
                }
            }

            Spacer(Modifier.height(18.dp))
            Text(
                ScheduleMath.fmtDuration(st.remainingMs),
                fontSize = 44.sp, fontWeight = FontWeight.Black,
                color = if (urgent) WL.Red else WL.Light
            )
            LinearProgressIndicator(
                progress = { pctLeft },
                modifier = Modifier.fillMaxWidth().height(6.dp).clip(WL.ButtonShape),
                color = if (urgent) WL.Red else WL.Amber,
                trackColor = WL.SurfaceAlt
            )
            Text("REMAINING", color = WL.Muted, fontSize = 11.sp, letterSpacing = 2.sp)

            if (st.isTest) {
                TextButton(onClick = { showExit = true }) {
                    Text("TEST / EMERGENCY EXIT", color = WL.Muted, fontSize = 12.sp)
                }
            }
            Spacer(Modifier.height(6.dp))
        }
    }

    if (showExit) ExitCodeDialog(onDismiss = { showExit = false })
}

private fun serviceSubmit(accepted: Boolean, text: String, score: Double) {
    ActiveService.instance?.submitSpeech(text, accepted, score)
}

@Composable
private fun ProgressDots(total: Int, done: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        repeat(total.coerceAtMost(12)) { i ->
            Box(
                Modifier.size(if (i < done) 15.dp else 13.dp).clip(CircleShape)
                    .background(if (i < done) WL.Success else WL.SurfaceAlt)
            )
        }
    }
}

@Composable
private fun ExitCodeDialog(onDismiss: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var err by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Test exit code") },
        text = {
            Column {
                Text("Development/testing only. Ends this TEST challenge.", fontSize = 13.sp)
                OutlinedTextField(code, { code = it; err = false }, label = { Text("Code") }, singleLine = true)
                if (err) Text("Incorrect code", color = WL.Red, fontSize = 12.sp)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                if (code == "0000") { ActiveService.instance?.testExit(); onDismiss() } else err = true
            }) { Text("EXIT") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("CANCEL") } }
    )
}

@Composable
private fun TerminalScreen(success: Boolean, message: String?, completionMs: Long, lines: Int, onDone: () -> Unit) {
    Box(Modifier.fillMaxSize().background(if (success) WL.Ink else Color(0xFF1A0C0C)), Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(28.dp)) {
            Text(if (success) "YOU'RE UP." else "CHALLENGE FAILED",
                fontSize = 38.sp, fontWeight = FontWeight.Black,
                color = if (success) WL.Amber else WL.Red, textAlign = TextAlign.Center)
            Spacer(Modifier.height(14.dp))
            if (success) {
                Text("✓ Challenge completed", color = WL.Success, fontSize = 16.sp)
                Text(ScheduleMath.fmtCompletion(completionMs), color = WL.Light,
                    fontSize = 30.sp, fontWeight = FontWeight.Bold)
                Text("$lines lines", color = WL.Muted)
            } else {
                Text(message ?: "You didn't complete this morning's challenge.",
                    color = WL.Light, textAlign = TextAlign.Center)
            }
            Spacer(Modifier.height(26.dp))
            Button(onClick = onDone, shape = WL.ButtonShape,
                colors = ButtonDefaults.buttonColors(containerColor = WL.Amber, contentColor = WL.Ink)) {
                Text(if (success) "START MY DAY" else "CLOSE", fontWeight = FontWeight.Black)
            }
        }
    }
}
