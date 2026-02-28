import Foundation
import UIKit

/**
 * Document classifier using text-heuristic keyword matching.
 *
 * Analyzes OCR-extracted text to determine the document type
 * (receipt, invoice, bill, contract, or generic).
 */
class DocumentClassifier {

    struct ClassificationResult {
        let type: String
        let confidence: Double
    }

    private static let receiptKeywords = [
        "receipt", "total", "subtotal", "tax", "change", "cash",
        "credit card", "debit", "thank you", "purchase", "store",
        "qty", "item", "price"
    ]

    private static let invoiceKeywords = [
        "invoice", "inv", "bill to", "ship to", "due date",
        "payment terms", "amount due", "balance due", "po number",
        "remittance", "net"
    ]

    private static let billKeywords = [
        "bill", "account number", "statement", "billing period",
        "amount due", "pay by", "utility", "service charge",
        "usage", "meter"
    ]

    private static let contractKeywords = [
        "contract", "agreement", "terms and conditions", "whereas",
        "hereby", "parties", "effective date", "signature",
        "witness", "clause"
    ]

    private let confidenceThreshold = 0.7

    /**
     * Classify a document based on its image and extracted text.
     *
     * - Parameter image: The document image (reserved for future visual classification)
     * - Parameter text: The OCR-extracted text to analyze
     * - Returns: ClassificationResult with type and confidence score
     */
    func classify(image: UIImage, text: String) -> ClassificationResult {
        let lowerText = text.lowercased()

        let scores: [String: Int] = [
            "receipt": countMatches(text: lowerText, keywords: DocumentClassifier.receiptKeywords),
            "invoice": countMatches(text: lowerText, keywords: DocumentClassifier.invoiceKeywords),
            "bill": countMatches(text: lowerText, keywords: DocumentClassifier.billKeywords),
            "contract": countMatches(text: lowerText, keywords: DocumentClassifier.contractKeywords)
        ]

        let totalMatches = scores.values.reduce(0, +)

        guard totalMatches > 0 else {
            return ClassificationResult(type: "generic", confidence: 0.5)
        }

        guard let topEntry = scores.max(by: { $0.value < $1.value }) else {
            return ClassificationResult(type: "generic", confidence: 0.5)
        }

        // Calculate confidence as proportion of total matches
        let baseConfidence = Double(topEntry.value) / Double(totalMatches)
        
        // Apply small boost only if we have strong indicators (3+ matches)
        let confidence: Double
        if topEntry.value >= 3 {
            confidence = min(baseConfidence * 1.15, 0.95) // Max 95% to indicate heuristic
        } else {
            confidence = baseConfidence * 0.85 // Reduce confidence for weak matches
        }

        if confidence < 0.5 || topEntry.value < 2 {
            return ClassificationResult(type: "generic", confidence: max(confidence, 0.4))
        }

        return ClassificationResult(
            type: topEntry.key,
            confidence: confidence
        )
    }

    private func countMatches(text: String, keywords: [String]) -> Int {
        return keywords.filter { text.contains($0) }.count
    }
}
