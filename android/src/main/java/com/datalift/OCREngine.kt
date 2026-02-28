package com.datalift

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * OCR engine using Google ML Kit Text Recognition.
 *
 * Performs on-device text extraction from bitmap images.
 * Supports Latin-based scripts by default.
 */
class OCREngine {

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    /**
     * Extract text from a bitmap image using ML Kit.
     *
     * @param bitmap The image to process
     * @return Extracted text as a single string with newline-separated lines
     */
    suspend fun extractText(bitmap: Bitmap): String =
        suspendCancellableCoroutine { continuation ->
            val image = InputImage.fromBitmap(bitmap, 0)

            recognizer.process(image)
                .addOnSuccessListener { visionText ->
                    val fullText = buildString {
                        visionText.textBlocks.forEach { block ->
                            block.lines.forEach { line ->
                                appendLine(line.text)
                            }
                        }
                    }
                    continuation.resume(fullText.trimEnd())
                }
                .addOnFailureListener { exception ->
                    continuation.resumeWithException(
                        RuntimeException("ML Kit text recognition failed: ${exception.message}", exception)
                    )
                }
        }

    /**
     * Release resources when no longer needed.
     */
    fun close() {
        recognizer.close()
    }
}
