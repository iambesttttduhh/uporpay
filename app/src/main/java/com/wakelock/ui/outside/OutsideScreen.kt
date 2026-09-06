package com.wakelock.ui.outside

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wakelock.outside.OutsideResult
import com.wakelock.outside.OutsideVerifier
import com.wakelock.ui.alarmscreen.ActiveService
import com.wakelock.ui.theme.WL
import kotlinx.coroutines.launch

@Composable
fun OutsideScreen(onVerified: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var result by remember { mutableStateOf<OutsideResult?>(null) }
    var busy by remember { mutableStateOf(false) }
    var explained by remember { mutableStateOf(false) }

    val permLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { }

    Box(Modifier.fillMaxSize().background(WL.Ink).padding(22.dp), Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("PROVE YOU'RE OUTSIDE", fontSize = 26.sp, fontWeight = FontWeight.Black,
                color = WL.Amber, textAlign = TextAlign.Center)
            Spacer(Modifier.height(10.dp))
            Text(
                "WakeLock checks movement, ambient light and location change. " +
                    "No single signal is treated as proof, and nothing is uploaded.",
                color = WL.Muted, fontSize = 13.sp, textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(22.dp))

            result?.let { r ->
                r.signals.forEach { s ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(s.name, color = WL.Light, fontSize = 14.sp)
                        Text(
                            if (!s.available) "unavailable" else if (s.passed) "✓ ${s.detail}" else "✗ ${s.detail}",
                            color = if (!s.available) WL.Muted else if (s.passed) WL.Success else WL.Red,
                            fontSize = 13.sp
                        )
                    }
                }
                Spacer(Modifier.height(12.dp))
                Text(
                    if (r.verified) "OUTSIDE VERIFIED ✓" else "VERIFICATION FAILED",
                    color = if (r.verified) WL.Success else WL.Red,
                    fontWeight = FontWeight.Black, fontSize = 18.sp
                )
                Text(r.reason, color = WL.Muted, fontSize = 12.sp, textAlign = TextAlign.Center)
                Spacer(Modifier.height(16.dp))
            }

            if (busy) { CircularProgressIndicator(color = WL.Amber); Spacer(Modifier.height(16.dp)) }

            Button(
                onClick = {
                    if (!explained) {
                        explained = true
                        permLauncher.launch(arrayOf(
                            Manifest.permission.ACCESS_COARSE_LOCATION,
                            Manifest.permission.ACCESS_FINE_LOCATION
                        ))
                        return@Button
                    }
                    busy = true
                    scope.launch {
                        val v = OutsideVerifier(ctx)
                        val r = v.verify(anchor = null)
                        result = r; busy = false
                        if (r.verified) { ActiveService.instance?.onOutsideVerified(); onVerified() }
                    }
                },
                enabled = !busy,
                shape = WL.ButtonShape,
                colors = ButtonDefaults.buttonColors(containerColor = WL.Amber, contentColor = WL.Ink),
                modifier = Modifier.fillMaxWidth().height(58.dp)
            ) {
                Text(
                    if (!explained) "ALLOW LOCATION & CONTINUE"
                    else if (result == null) "VERIFY I'M OUTSIDE" else "RETRY VERIFICATION",
                    fontWeight = FontWeight.Black
                )
            }
        }
    }
}
