package com.wakelock.speech

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log

enum class SpeechStatus { IDLE, LISTENING, CHECKING, VERIFIED, TRY_AGAIN, UNAVAILABLE }

/**
 * Thin wrapper around Android SpeechRecognizer. Real recognition only - never simulated.
 * Must be created and used on the main thread.
 */
class SpeechClient(private val ctx: Context) {

    private var recognizer: SpeechRecognizer? = null
    var available: Boolean = SpeechRecognizer.isRecognitionAvailable(ctx)
        private set

    fun destroy() {
        try { recognizer?.destroy() } catch (_: Exception) {}
        recognizer = null
    }

    fun cancel() { try { recognizer?.cancel() } catch (_: Exception) {} }

    fun stopListening() { try { recognizer?.stopListening() } catch (_: Exception) {} }

    /**
     * @param onResult final transcript (may be blank if nothing was heard)
     * @param onError  human-readable error
     * @param onLevel  mic amplitude 0..1 for the UI
     */
    fun start(
        onPartial: (String) -> Unit,
        onResult: (String) -> Unit,
        onError: (String) -> Unit,
        onLevel: (Float) -> Unit
    ) {
        available = SpeechRecognizer.isRecognitionAvailable(ctx)
        if (!available) { onError("Speech recognition is not available on this device."); return }
        try {
            destroy()
            recognizer = SpeechRecognizer.createSpeechRecognizer(ctx).apply {
                setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {}
                    override fun onBeginningOfSpeech() {}
                    override fun onRmsChanged(rmsdB: Float) {
                        onLevel(((rmsdB + 2f) / 12f).coerceIn(0f, 1f))
                    }
                    override fun onBufferReceived(buffer: ByteArray?) {}
                    override fun onEndOfSpeech() {}
                    override fun onError(error: Int) {
                        onError(describe(error))
                    }
                    override fun onResults(results: Bundle?) {
                        val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        onResult(list?.firstOrNull().orEmpty())
                    }
                    override fun onPartialResults(partialResults: Bundle?) {
                        val list = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        list?.firstOrNull()?.let(onPartial)
                    }
                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })
            }
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.packageName)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    // privacy-preserving: keep it on-device where the device supports it
                    putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                }
            }
            recognizer?.startListening(intent)
        } catch (e: Exception) {
            Log.e("WL/Speech", "start failed", e)
            onError("Could not start the microphone. Try again.")
        }
    }

    private fun describe(code: Int): String = when (code) {
        SpeechRecognizer.ERROR_AUDIO -> "Microphone error. Try again."
        SpeechRecognizer.ERROR_CLIENT -> "Recogniser error. Try again."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is required."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
            "This device needs a network for speech recognition."
        SpeechRecognizer.ERROR_NO_MATCH -> "I couldn't understand that. Speak clearly and try again."
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recogniser busy. Try again in a second."
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "I didn't hear anything. Try again."
        SpeechRecognizer.ERROR_SERVER -> "Speech service error. Try again."
        else -> "Speech error. Try again."
    }
}
