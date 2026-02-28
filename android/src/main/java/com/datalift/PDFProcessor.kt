package com.datalift

import android.content.Context
import android.graphics.Bitmap
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.rendering.PDFRenderer
import java.io.File
import java.io.FileOutputStream

/**
 * PDF processor that extracts pages as images for OCR processing.
 *
 * Uses PDFBox-Android to render PDF pages to bitmap images,
 * which are then saved as temporary files for the OCR pipeline.
 */
class PDFProcessor(private val context: Context) {

    init {
        PDFBoxResourceLoader.init(context)
    }

    /**
     * Extract specific pages from a PDF as image files.
     *
     * @param pdfUri File path to the PDF document
     * @param pages List of 0-based page indices to extract
     * @return List of file paths to the extracted page images
     */
    fun extractPages(pdfUri: String, pages: List<Int>): List<String> {
        val document = PDDocument.load(File(pdfUri))
        val renderer = PDFRenderer(document)
        val extractedPaths = mutableListOf<String>()

        try {
            val totalPages = document.numberOfPages

            for (pageIndex in pages) {
                if (pageIndex < 0 || pageIndex >= totalPages) {
                    continue
                }

                // Render page at 300 DPI for good OCR quality
                val bitmap = renderer.renderImageWithDPI(pageIndex, 300f)

                // Save to temporary file
                val outputFile = File(
                    context.cacheDir,
                    "datalift_page_${pageIndex}_${System.currentTimeMillis()}.png"
                )

                FileOutputStream(outputFile).use { outputStream ->
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
                }

                extractedPaths.add(outputFile.absolutePath)
                bitmap.recycle()
            }
        } finally {
            document.close()
        }

        return extractedPaths
    }
}
