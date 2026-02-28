import Foundation
import UIKit
import Vision

/**
 * OCR engine using Apple Vision framework (VNRecognizeTextRequest).
 *
 * Performs on-device text extraction from UIImage using the Vision framework.
 * Supports multiple languages and provides accurate text recognition with confidence scores.
 */
class OCREngine {

    struct OCRResult {
        let text: String
        let confidence: Float
    }

    /**
     * Extract text from a UIImage using Apple Vision.
     *
     * - Parameter image: The UIImage to process
     * - Parameter language: Language hint (e.g., "en", "es", "fr")
     * - Returns: OCRResult with extracted text and average confidence
     * - Throws: DataLiftError if extraction fails
     */
    func extractText(from image: UIImage, language: String = "en") throws -> OCRResult {
        guard let cgImage = image.cgImage else {
            throw DataLiftError.ocrFailed("Failed to convert UIImage to CGImage")
        }

        var extractedText = ""
        var recognitionError: Error?
        var totalConfidence: Float = 0.0
        var lineCount: Int = 0

        let semaphore = DispatchSemaphore(value: 0)

        let request = VNRecognizeTextRequest { request, error in
            defer { semaphore.signal() }

            if let error = error {
                recognitionError = error
                return
            }

            guard let observations = request.results as? [VNRecognizedTextObservation] else {
                return
            }

            var lines: [String] = []
            
            for observation in observations {
                guard let candidate = observation.topCandidates(1).first else { continue }
                
                lines.append(candidate.string)
                totalConfidence += candidate.confidence
                lineCount += 1
            }

            extractedText = lines.joined(separator: "\n")
        }

        // Configure recognition for accuracy
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true

        // Set recognition languages
        if #available(iOS 16.0, *) {
            request.automaticallyDetectsLanguage = true
        }
        request.recognitionLanguages = [language, "en"]

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

        do {
            try handler.perform([request])
        } catch {
            throw DataLiftError.ocrFailed("Vision request failed: \(error.localizedDescription)")
        }

        // Wait for async completion
        semaphore.wait()

        if let error = recognitionError {
            throw DataLiftError.ocrFailed("Text recognition failed: \(error.localizedDescription)")
        }

        // Calculate average confidence
        let avgConfidence = lineCount > 0 ? totalConfidence / Float(lineCount) : 0.5

        return OCRResult(text: extractedText, confidence: avgConfidence)
    }
}
