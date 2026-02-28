package com.datalift

import android.graphics.Bitmap

/**
 * Document classifier using text-heuristic keyword matching.
 *
 * Analyzes OCR-extracted text to determine the document type
 * (receipt, invoice, bill, contract, or generic).
 */
class DocumentClassifier {

    data class ClassificationResult(
        val type: String,
        val confidence: Double
    )

    companion object {
        private val RECEIPT_KEYWORDS = listOf(
            "receipt", "total", "subtotal", "tax", "change", "cash",
            "credit card", "debit", "thank you", "purchase", "store",
            "qty", "item", "price"
        )

        private val INVOICE_KEYWORDS = listOf(
            "invoice", "inv", "bill to", "ship to", "due date",
            "payment terms", "amount due", "balance due", "po number",
            "remittance", "net"
        )

        private val BILL_KEYWORDS = listOf(
            "bill", "account number", "statement", "billing period",
            "amount due", "pay by", "utility", "service charge",
            "usage", "meter"
        )

        private val CONTRACT_KEYWORDS = listOf(
            "contract", "agreement", "terms and conditions", "whereas",
            "hereby", "parties", "effective date", "signature",
            "witness", "clause"
        )

        private const val CONFIDENCE_THRESHOLD = 0.7
        private const val CONFIDENCE_BOOST = 0.3
    }

    /**
     * Classify a document based on its image and extracted text.
     *
     * @param bitmap The document image (reserved for future visual classification)
     * @param text The OCR-extracted text to analyze
     * @return ClassificationResult with type and confidence score
     */
    fun classify(bitmap: Bitmap, text: String): ClassificationResult {
        val lowerText = text.lowercase()

        val scores = mapOf(
            "receipt" to countMatches(lowerText, RECEIPT_KEYWORDS),
            "invoice" to countMatches(lowerText, INVOICE_KEYWORDS),
            "bill" to countMatches(lowerText, BILL_KEYWORDS),
            "contract" to countMatches(lowerText, CONTRACT_KEYWORDS)
        )

        val totalMatches = scores.values.sum()
        if (totalMatches == 0) {
            return ClassificationResult("generic", 0.5)
        }

        val topEntry = scores.maxByOrNull { it.value }!!
        val confidence = topEntry.value.toDouble() / totalMatches.toDouble()

        return if (confidence < CONFIDENCE_THRESHOLD && topEntry.value < 3) {
            ClassificationResult("generic", 0.5)
        } else {
            ClassificationResult(
                topEntry.key,
                minOf(confidence + CONFIDENCE_BOOST, 1.0)
            )
        }
    }

    private fun countMatches(text: String, keywords: List<String>): Int {
        return keywords.count { text.contains(it) }
    }
}
