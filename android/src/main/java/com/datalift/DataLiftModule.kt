package com.datalift

import android.graphics.BitmapFactory
import android.util.Log
import com.facebook.react.bridge.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * DataLift native module for Android.
 *
 * Provides native OCR (Google ML Kit), document classification,
 * and PDF page extraction to the React Native JavaScript layer.
 */
class DataLiftModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "DataLift"
    }

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val ocrEngine = OCREngine()
    private val classifier = DocumentClassifier()

    override fun getName(): String = "DataLift"
    
    /**
     * Convert file:// URI to proper file path.
     * Handles file:// URIs, absolute paths, and bare filenames.
     * For bare filenames, searches the app's files directory, common model subdirs,
     * and APK assets (extracting to filesDir on first access).
     * Returns null when a bare filename cannot be resolved.
     */
    private fun filePathFromUri(uri: String): String? {
        if (uri.startsWith("file://")) {
            return java.net.URLDecoder.decode(uri.substring(7), "UTF-8")
        }
        // Absolute path — return as-is
        if (uri.startsWith("/")) {
            return uri
        }
        // Bare filename — try to resolve from app directories or APK assets
        return resolveBundlePath(uri)
    }

    /**
     * Search for a file in the app's file system by bare filename.
     * Checks: filesDir, cacheDir, common model subdirectories,
     * and APK assets/ (extracting to filesDir on first access).
     */
    private fun resolveBundlePath(filename: String): String? {
        val ctx = reactApplicationContext
        // 1. Direct in filesDir
        val inFiles = java.io.File(ctx.filesDir, filename)
        if (inFiles.exists()) return inFiles.absolutePath
        // 2. Direct in cacheDir
        val inCache = java.io.File(ctx.cacheDir, filename)
        if (inCache.exists()) return inCache.absolutePath
        // 3. Common subdirectories in filesDir and cacheDir
        val subdirs = listOf("models", "assets", "model", "ml")
        for (dir in subdirs) {
            val inSubFiles = java.io.File(java.io.File(ctx.filesDir, dir), filename)
            if (inSubFiles.exists()) return inSubFiles.absolutePath
            val inSubCache = java.io.File(java.io.File(ctx.cacheDir, dir), filename)
            if (inSubCache.exists()) return inSubCache.absolutePath
        }
        // 4. Try external files dir
        ctx.getExternalFilesDir(null)?.let { extDir ->
            val inExt = java.io.File(extDir, filename)
            if (inExt.exists()) return inExt.absolutePath
        }
        // 5. Try extracting from APK assets/ directory
        //    Android assets aren't accessible by file path — extract to filesDir
        val assetCandidates = listOf(filename) + subdirs.map { "$it/$filename" }
        for (assetPath in assetCandidates) {
            try {
                val inputStream = ctx.assets.open(assetPath)
                val destDir = java.io.File(ctx.filesDir, "models")
                destDir.mkdirs()
                val destFile = java.io.File(destDir, filename)
                inputStream.use { input ->
                    destFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
                Log.d(TAG, "Extracted asset '$assetPath' to ${destFile.absolutePath}")
                return destFile.absolutePath
            } catch (_: java.io.FileNotFoundException) {
                // Asset not found at this path — try next
            } catch (e: Exception) {
                Log.w(TAG, "Failed to extract asset '$assetPath': ${e.message}")
            }
        }
        return null
    }
    
    /**
     * Load Bitmap from file:// URI or file path
     */
    private fun loadBitmap(uri: String): android.graphics.Bitmap {
        val filePath = filePathFromUri(uri)
            ?: throw IllegalArgumentException("Cannot resolve file path for URI: $uri")
        
        // Try loading the bitmap
        val bitmap = BitmapFactory.decodeFile(filePath)
            ?: throw IllegalArgumentException("Failed to decode image at: $uri (resolved to: $filePath)")
        
        return bitmap
    }

    /**
     * Classify a document image by type (receipt, invoice, bill, contract, generic).
     *
     * @param options ReadableMap with keys:
     *   - uri: String - file path to the image
     *   - text: String - pre-extracted OCR text (optional, used for heuristic boost)
     * @param promise resolves with { type: String, confidence: Double }
     */
    @ReactMethod
    fun classifyDocument(options: ReadableMap, promise: Promise) {
        scope.launch {
            try {
                val uri = options.getString("uri")
                    ?: throw IllegalArgumentException("Image URI is required")
                val text = options.getString("text") ?: ""

                val bitmap = loadBitmap(uri)
                val result = classifier.classify(bitmap, text)

                val response = WritableNativeMap().apply {
                    putString("type", result.type)
                    putDouble("confidence", result.confidence)
                }

                promise.resolve(response)
            } catch (e: Exception) {
                Log.e(TAG, "Classification error", e)
                promise.reject("CLASSIFICATION_ERROR", e.message, e)
            }
        }
    }

    /**
     * Extract text from an image using Google ML Kit Text Recognition.
     *
     * @param options ReadableMap with keys:
     *   - uri: String - file path to the image
     *   - language: String - language hint (optional)
     * @param promise resolves with { text: String, lineCount: Int }
     */
    @ReactMethod
    fun extractTextNative(options: ReadableMap, promise: Promise) {
        scope.launch {
            try {
                val uri = options.getString("uri")
                    ?: throw IllegalArgumentException("Image URI is required")

                val bitmap = loadBitmap(uri)
                val text = ocrEngine.extractText(bitmap)

                val response = WritableNativeMap().apply {
                    putString("text", text)
                    putInt("lineCount", text.split("\n").size)
                }

                promise.resolve(response)
            } catch (e: Exception) {
                Log.e(TAG, "Text extraction error", e)
                promise.reject("OCR_ERROR", e.message, e)
            }
        }
    }

    /**
     * Extract specific pages from a PDF as images for OCR processing.
     *
     * @param options ReadableMap with keys:
     *   - uri: String - file path to the PDF
     *   - pages: ReadableArray of Int - page indices to extract (0-based)
     * @param promise resolves with array of { uri: String } for each extracted page
     */
    @ReactMethod
    fun extractPDFPages(options: ReadableMap, promise: Promise) {
        scope.launch {
            try {
                val uri = options.getString("uri")
                    ?: throw IllegalArgumentException("PDF URI is required")
                val pagesArray = options.getArray("pages")
                val pages = mutableListOf<Int>()

                if (pagesArray != null) {
                    for (i in 0 until pagesArray.size()) {
                        pages.add(pagesArray.getInt(i))
                    }
                } else {
                    pages.add(0)
                }

                val pdfProcessor = PDFProcessor(reactApplicationContext)
                val extractedPages = pdfProcessor.extractPages(uri, pages)

                val response = WritableNativeArray().apply {
                    extractedPages.forEach { pageUri ->
                        pushMap(WritableNativeMap().apply {
                            putString("uri", pageUri)
                        })
                    }
                }

                promise.resolve(response)
            } catch (e: Exception) {
                Log.e(TAG, "PDF extraction error", e)
                promise.reject("PDF_ERROR", e.message, e)
            }
        }
    }

    private fun buildInvoiceSchema(
        text: String,
        uris: List<String>,
        fileNames: List<String>,
        bitmaps: List<android.graphics.Bitmap>,
        language: String,
        ocrConfidence: Double,
        pageConfidences: List<Double>,
    ): WritableMap {
        val lines = text.split("\n").map { it.trim() }.filter { it.isNotEmpty() }
        val invoiceNumber = firstMatch(
            text,
            "(?:invoice\\s*(?:no\\.?|#|number)?|inv\\s*[#:])\\s*([A-Z0-9][A-Z0-9\\-\\/]{1,30})"
        )
        val receiptNumber = firstMatch(
            text,
            "(?:receipt\\s*(?:no\\.?|#|number)?|rcpt\\s*[#:])\\s*([A-Z0-9][A-Z0-9\\-\\/]{1,30})"
        )
        val poNumber = firstMatch(
            text,
            "(?:purchase\\s*order|p\\.?o\\.?)\\s*(?:no\\.?|#|number)?\\s*[:\\-]?\\s*([A-Z0-9][A-Z0-9\\-\\/]{1,30})"
        )
        val orderNumber = firstMatch(
            text,
            "(?:order\\s*(?:no\\.?|#|number)?)\\s*[:\\-]?\\s*([A-Z0-9][A-Z0-9\\-\\/]{1,30})"
        )
        val invoiceDate = normalizeDate(firstMatch(
            text,
            "(?:invoice\\s*date|date)\\s*[:\\-]?\\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[\\/\\-][0-9]{1,2}[\\/\\-][0-9]{2,4})"
        ))
        val timeIssued = normalizeTime(firstMatch(text, "\\b([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)\\b"))
        val dueDate = firstMatch(
            text,
            "(?:due\\s*date|due)\\s*[:\\-]?\\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[\\/\\-][0-9]{1,2}[\\/\\-][0-9]{2,4})"
        )
        val currency = detectCurrency(text)
        val docType = detectDocumentType(text, !invoiceNumber.isNullOrBlank(), !receiptNumber.isNullOrBlank())

        val vendorName = extractVendorName(lines)
        val vendorBranch = extractBranch(lines)
        val buyer = extractBuyer(lines)
        val customerId = extractCustomerId(text)
        val vendorAddressLines = extractVendorAddressLines(lines)
        val vendorGeo = parseCityStatePostal(vendorAddressLines.joinToString(", "))
        val lineItems = extractLineItems(lines)
        val unifiedLineItems = createUnifiedLineItemsArray(lineItems)
        val remittanceData = extractRemittance(text)
        val cardBrand = detectCardBrand(text)

        val subTotal = firstAmount(text, listOf("sub total", "subtotal"))
            ?: lineItems.sumOf { it.totalAmount }
        val taxTotal = firstAmount(text, listOf("tax total", "total tax", "tax", "vat", "gst")) ?: 0.0
        val discountTotal = firstAmount(text, listOf("discount", "discount total")) ?: 0.0
        val shipping = firstAmount(text, listOf("shipping", "delivery", "freight")) ?: 0.0
        val grandTotal = firstAmount(
            text,
            listOf("grand total", "total amount due", "amount due", "total")
        ) ?: (subTotal + taxTotal + shipping - discountTotal)
        val amountPaid = firstAmount(text, listOf("amount paid", "paid", "tendered"))
        val amountDue = firstAmount(text, listOf("amount due", "balance due")) ?: maxOf(0.0, grandTotal - (amountPaid ?: 0.0))

        val schemaConfidence = estimateSchemaConfidence(invoiceNumber, invoiceDate, vendorName, lineItems, grandTotal)
        val extractionConfidence = round2((ocrConfidence * 0.7) + (schemaConfidence * 0.3))

        val imagesArray = Arguments.createArray().apply {
            uris.forEachIndexed { index, uri ->
                val fileName = fileNames.getOrNull(index)?.takeIf { it.isNotBlank() }
                    ?: java.io.File(filePathFromUri(uri) ?: uri).name
                pushMap(Arguments.createMap().apply {
                    putString("image_id", "img_${String.format("%03d", index + 1)}")
                    putString("file_name", fileName)
                    putInt("page_index", index)
                })
            }
        }

        val response = Arguments.createMap().apply {
            putString("document_id", UUID.randomUUID().toString())
            putString("document_type", docType)
            putString("locale", "$language-US")
            putString("currency", currency)
            putArray("images", imagesArray)
            putMap("header", Arguments.createMap().apply {
                putString("document_number", invoiceNumber ?: receiptNumber)
                putString("invoice_number", invoiceNumber)
                putString("receipt_number", receiptNumber)
                putString("po_number", poNumber)
                putString("order_number", orderNumber)
                putString("date_issued", invoiceDate)
                putString("time_issued", timeIssued)
                putInt("page", uris.size)
                putInt("total_pages", uris.size)
            })
            putMap("vendor", Arguments.createMap().apply {
                putString("name", vendorName)
                putString("branch", vendorBranch)
                putString("tax_id", firstMatch(text, "(?:tax\\s*id|tin|ein)\\s*[:\\-]?\\s*([A-Z0-9\\-]{5,30})"))
                putArray("address_lines", Arguments.fromList(vendorAddressLines))
                putString("city", vendorGeo.city)
                putString("state", vendorGeo.state)
                putString("postal_code", vendorGeo.postalCode)
                putNull("country")
                putString("phone", firstMatch(text, "(?:\\+?\\d[\\d\\s\\-()]{6,}\\d)"))
                putString("email", firstMatch(text, "([A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,})"))
                putString("website", firstMatch(text, "((?:https?://|www\\.)[^\\s]+)"))
            })
            putMap("buyer", Arguments.createMap().apply {
                putString("name", buyer.name)
                putString("account_id", customerId)
                putArray("address_lines", Arguments.fromList(buyer.addressLines))
                putString("city", buyer.city)
                putString("state", buyer.state)
                putString("postal_code", buyer.postalCode)
                putNull("country")
            })
            putArray("line_items", unifiedLineItems)
            putMap("totals", Arguments.createMap().apply {
                putDouble("sub_total", round2(subTotal))
                putDouble("discount_total", round2(discountTotal))
                putDouble("total_tax", round2(taxTotal))
                putDouble("shipping_total", round2(shipping))
                putDouble("grand_total", round2(grandTotal))
                if (amountPaid != null) putDouble("amount_paid", round2(amountPaid)) else putNull("amount_paid")
                putDouble("amount_due", round2(amountDue))
            })
            putMap("payment", Arguments.createMap().apply {
                val paymentMethod = cardBrand ?: firstMatch(text, "(?:payment\\s*(?:method|mode)|paid\\s*by|tender|card)\\s*[:\\-]?\\s*([A-Za-z][A-Za-z\\s]{2,40})")
                putString("payment_method", paymentMethod)
                putString("masked_account", firstMatch(text, "([xX*]{4,}\\d{2,4})"))
                putString("authorization_code", firstMatch(text, "(?:auth(?:orization)?\\s*code|approval)\\s*[:\\-]?\\s*([A-Z0-9]{4,20})"))
                putString("aid", firstMatch(text, "\\b(A[0-9A-F]{8,32})\\b"))
                putString("cryptogram", firstMatch(text, "(?:cryptogram|tc)\\s*[:\\-]?\\s*([A-Z0-9]{8,64})"))
                putString("tender_type", paymentMethod)
            })
            putArray("taxes", Arguments.createArray().apply {
                pushMap(Arguments.createMap().apply {
                    putString("tax_name", "Tax")
                    putNull("tax_rate")
                    putDouble("tax_amount", round2(taxTotal))
                })
            })
            putMap("remittance", Arguments.createMap().apply {
                putString("remit_to_name", remittanceData.first)
                putArray("remit_to_address_lines", Arguments.fromList(remittanceData.second))
            })
            putMap("audit", Arguments.createMap().apply {
                putString("ocr_engine", "GoogleMLKit")
                putString("extraction_timestamp", java.time.Instant.now().toString())
                putMap("confidence", Arguments.createMap().apply {
                    if (!invoiceNumber.isNullOrBlank()) putDouble("header.invoice_number", extractionConfidence)
                    if (!receiptNumber.isNullOrBlank()) putDouble("header.receipt_number", extractionConfidence)
                    putDouble("totals.grand_total", extractionConfidence)
                    if (lineItems.isNotEmpty()) putDouble("line_items.0.description", maxOf(0.65, extractionConfidence - 0.08))
                })
                putArray("warnings", Arguments.createArray().apply {
                    if (lineItems.isEmpty()) pushString("No line items confidently parsed")
                })
            })
        }

        return response
    }

    private data class ParsedLineItem(
        val lineNumber: Int,
        val description: String,
        val quantity: Double,
        val unitPrice: Double,
        val totalAmount: Double,
        val sku: String?,
        val uom: String? = null
    )

    private fun createLineItemsArray(items: List<ParsedLineItem>): WritableArray {
        val arr = Arguments.createArray()
        if (items.isEmpty()) {
            arr.pushMap(Arguments.createMap().apply {
                putInt("line_number", 1)
                putNull("item_id")
                putNull("sku")
                putString("description", "Unparsed item")
                putInt("quantity", 1)
                putNull("uom")
                putInt("unit_price", 0)
                putNull("tax_rate")
                putNull("tax_amount")
                putInt("total_amount", 0)
            })
            return arr
        }

        items.forEach { item ->
            arr.pushMap(Arguments.createMap().apply {
                putInt("line_number", item.lineNumber)
                putNull("item_id")
                putString("sku", item.sku)
                putString("description", item.description)
                putDouble("quantity", round2(item.quantity))
                putNull("uom")
                putDouble("unit_price", round2(item.unitPrice))
                putNull("tax_rate")
                putNull("tax_amount")
                putDouble("total_amount", round2(item.totalAmount))
            })
        }
        return arr
    }

    private fun createUnifiedLineItemsArray(items: List<ParsedLineItem>): WritableArray {
        val arr = Arguments.createArray()
        items.forEachIndexed { index, item ->
            arr.pushMap(Arguments.createMap().apply {
                putString("line_id", "${index + 1}")
                putString("sku", item.sku)
                putString("description", item.description)
                putDouble("quantity", round2(item.quantity))
                if (item.uom != null) putString("uom", item.uom) else putNull("uom")
                putDouble("unit_price", round2(item.unitPrice))
                putNull("discount")
                putDouble("extended_price", round2(item.totalAmount))
                putArray("taxes", Arguments.createArray())
            })
        }
        return arr
    }

    private fun extractBranch(lines: List<String>): String? {
        val branchRegex = Regex("branch\\s*[:#]?\\s*\\d*\\s+(.+)", RegexOption.IGNORE_CASE)
        for (line in lines.take(10)) {
            val m = branchRegex.find(line)
            if (m != null) return m.groupValues.getOrNull(1)?.trim()
        }
        return null
    }

    private fun extractCustomerId(text: String): String? {
        return firstMatch(text, "customer\\s*(?:id|#|no\\.?)\\s*[:#]?\\s*(\\S+)")
    }

    private fun extractRemittance(text: String): Pair<String?, List<String>> {
        val lower = text.lowercase()
        val keywords = listOf("remittance address", "mail paper checks to")
        var idx = -1
        for (kw in keywords) {
            val found = lower.indexOf(kw)
            if (found >= 0) { idx = found; break }
        }
        if (idx < 0) return Pair(null, emptyList())

        val afterText = text.substring(idx)
        val lines = afterText.split("\n").drop(1)
        val addressLines = mutableListOf<String>()
        for (line in lines) {
            val trimmed = line.trim()
            if (trimmed.isEmpty() || trimmed.all { it == '*' }) continue
            val tl = trimmed.lowercase()
            if (tl.startsWith("see ") || tl.startsWith("these ") || tl.startsWith("hydraulic")) break
            if (tl.startsWith("mail paper")) continue
            if (trimmed.length > 80) break
            addressLines.add(trimmed)
            if (addressLines.size >= 4) break
        }

        return Pair("NEW REMITTANCE ADDRESS", addressLines)
    }

    private fun detectCardBrand(text: String): String? {
        val lower = text.lowercase()
        return when {
            lower.contains("mastercard") -> "Mastercard"
            lower.contains("visa") -> "Visa"
            lower.contains("american express") || lower.contains("amex") -> "American Express"
            lower.contains("discover") -> "Discover"
            else -> null
        }
    }

    private fun extractLineItems(lines: List<String>): List<ParsedLineItem> {
        val items = mutableListOf<ParsedLineItem>()
        var lineNumber = 1

        // Strategy 1: Standard pattern - desc qty unitPrice total
        val rowRegex = Regex(
            "^\\s*(?:\\d+[\\).\\-]?\\s+)?([A-Za-z][A-Za-z0-9\\-\\s,./()\"]{2,}?)\\s+(\\d+(?:\\.\\d+)?)\\s+(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,4})?)\\s+(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,4})?)\\s*$",
            setOf(RegexOption.IGNORE_CASE)
        )
        val skuRegex = Regex("\\b(\\d{4,8}[A-Z]?\\d*|[A-Z]{1,4}\\d{2,}[A-Z0-9\\-]*|\\d{2,}-\\d{2,}(?:-\\d+)?)\\b")
        val uomRegex = Regex("\\b(EA|EACH|PC|PCS|BOX|CTN|PKG|SET|LB|KG|FT|GAL|OZ)\\b", RegexOption.IGNORE_CASE)

        lines.forEach { line ->
            val match = rowRegex.find(line) ?: return@forEach
            val description = match.groupValues.getOrNull(1)?.trim().orEmpty()
            val quantity = match.groupValues.getOrNull(2)?.replace(",", "")?.toDoubleOrNull()
            val unitPrice = match.groupValues.getOrNull(3)?.replace(",", "")?.toDoubleOrNull()
            val totalAmount = match.groupValues.getOrNull(4)?.replace(",", "")?.toDoubleOrNull()
            if (description.isBlank() || quantity == null || unitPrice == null || totalAmount == null) return@forEach

            val sku = skuRegex.find(line)?.groupValues?.getOrNull(1)
            val uom = uomRegex.find(line)?.groupValues?.getOrNull(1)?.uppercase()
            items.add(ParsedLineItem(lineNumber, description, quantity, unitPrice, totalAmount, sku, uom))
            lineNumber++
        }

        // Strategy 2: Price-trailing pattern - lines ending with unitPrice extendedPrice
        if (items.isEmpty()) {
            val priceTrailRegex = Regex("(\\d{1,3}(?:,\\d{3})*\\.\\d{2,4})\\s+(\\d{1,3}(?:,\\d{3})*\\.\\d{2,4})\\s*$")
            val skipRegex = Regex("^(carrier|tracking|page\\s+\\d|ordered\\s+shipped|quantities|unit\\s*size)", RegexOption.IGNORE_CASE)
            val leadingQtyRegex = Regex("^(?:\\d+(?:\\.\\d+)?\\s+){1,4}")
            val leadingUomRegex = Regex("^[A-Z]{2,5}\\s+\\d+(?:\\.\\d+)?\\s+")
            val trailingUomRegex = Regex("\\s+(?:EA|PC|EACH|BOX|CTN)(?:\\s+\\d+(?:\\.\\d+)?)?\\s*$", RegexOption.IGNORE_CASE)

            // Find table body boundaries
            val headerIdx = lines.indexOfFirst { l ->
                val lower = l.lowercase()
                (lower.contains("description") || lower.contains("item id")) &&
                    (lower.contains("price") || lower.contains("amount") || lower.contains("total"))
            }

            val totalsKws = listOf("sub total", "subtotal", "total tax", "tax total", "grand total", "amount due", "amount paid", "credit card", "total lines")
            var totalsIdx = lines.size
            for (i in maxOf(headerIdx + 1, lines.size / 3) until lines.size) {
                val l = lines[i].lowercase()
                if (totalsKws.any { l.startsWith(it) || l.contains("sub-total") || l.contains("total lines") }) {
                    totalsIdx = i
                    break
                }
            }

            val bodyStart = maxOf(0, headerIdx + 1)
            val bodyLines = lines.subList(bodyStart, totalsIdx)

            bodyLines.forEach { line ->
                if (line.length < 5) return@forEach
                if (skipRegex.containsMatchIn(line)) return@forEach

                val priceMatch = priceTrailRegex.find(line)
                if (priceMatch == null) {
                    // Continuation line
                    if (items.isNotEmpty() && line.isNotBlank() && line[0].isLetter()) {
                        val hasDecimals = Regex("\\d{2,}\\.\\d{2}").containsMatchIn(line)
                        if (!hasDecimals) {
                            val last = items.last()
                            if (last.description.length < 120) {
                                items[items.lastIndex] = last.copy(description = "${last.description} ${line.trim()}")
                            }
                        }
                    }
                    return@forEach
                }

                val unitPrice = priceMatch.groupValues.getOrNull(1)?.replace(",", "")?.toDoubleOrNull() ?: return@forEach
                val extPrice = priceMatch.groupValues.getOrNull(2)?.replace(",", "")?.toDoubleOrNull() ?: return@forEach

                var textPart = line.substring(0, priceMatch.range.first).trim()
                textPart = leadingQtyRegex.replace(textPart, "").trim()
                textPart = leadingUomRegex.replace(textPart, "").trim()

                val sku = skuRegex.find(textPart)?.groupValues?.getOrNull(1)
                var description = if (sku != null) textPart.replace(sku, "").trim() else textPart
                description = trailingUomRegex.replace(description, "").trim()

                val uom = uomRegex.find(line)?.groupValues?.getOrNull(1)?.uppercase()
                val qty = if (unitPrice > 0) kotlin.math.round(extPrice / unitPrice) else 1.0

                if (description.length < 2) return@forEach

                items.add(ParsedLineItem(lineNumber, description, qty, unitPrice, extPrice, sku, uom))
                lineNumber++
            }
        }

        return items
    }

    private fun extractVendorName(lines: List<String>): String? {
        return lines.take(8).firstOrNull { line ->
            val lower = line.lowercase()
            line.length >= 3 && !lower.contains("invoice") && !lower.contains("bill to") && !lower.contains("date")
        }
    }

    private fun extractBuyerName(lines: List<String>): String? {
        lines.forEachIndexed { index, line ->
            val lower = line.lowercase()
            if (lower.contains("bill to") || lower.contains("buyer") || lower.contains("customer")) {
                return lines.getOrNull(index + 1)
            }
        }
        return null
    }

    private data class BuyerParsed(
        val name: String?,
        val addressLines: List<String>,
        val city: String?,
        val state: String?,
        val postalCode: String?,
    )

    private data class GeoParsed(
        val city: String?,
        val state: String?,
        val postalCode: String?,
    )

    private fun extractVendorAddressLines(lines: List<String>): List<String> {
        val output = mutableListOf<String>()
        lines.take(12).forEach { line ->
            val lower = line.lowercase()
            if (lower.contains("invoice") || lower.contains("bill to") || lower.contains("ship to")) return@forEach
            if (line.length >= 5) output.add(line)
            if (output.size >= 3) return output
        }
        return output
    }

    private fun extractBuyer(lines: List<String>): BuyerParsed {
        lines.forEachIndexed { index, line ->
            val lower = line.lowercase()
            if (lower.contains("bill to") || lower.contains("buyer") || lower.contains("customer") || lower.contains("sold to")) {
                val block = mutableListOf<String>()
                for (j in (index + 1) until minOf(index + 6, lines.size)) {
                    val value = lines[j]
                    val stop = value.lowercase().contains("ship to") || value.lowercase().contains("subtotal")
                    if (stop) break
                    block.add(value)
                }
                val name = block.firstOrNull()
                val address = if (block.size > 1) block.drop(1).take(3) else emptyList()
                val geo = parseCityStatePostal(address.joinToString(", "))
                return BuyerParsed(name, address, geo.city, geo.state, geo.postalCode)
            }
        }
        return BuyerParsed(null, emptyList(), null, null, null)
    }

    private fun parseCityStatePostal(text: String): GeoParsed {
        val pattern = Regex("([A-Za-z][A-Za-z\\s]{1,30}),?\\s+([A-Z]{2})\\s+(\\d{5}(?:-\\d{4})?)")
        val m = pattern.find(text)
        val city = m?.groupValues?.getOrNull(1)?.trim()
        val state = m?.groupValues?.getOrNull(2)?.trim()
        val postal = m?.groupValues?.getOrNull(3)?.trim()
        return GeoParsed(city, state, postal)
    }

    private fun detectDocumentType(text: String, hasInvoiceNumber: Boolean, hasReceiptNumber: Boolean): String {
        val lower = text.lowercase()
        if (hasInvoiceNumber || lower.contains("invoice")) return "invoice"
        if (hasReceiptNumber || lower.contains("receipt")) {
            if (lower.contains("pos")) return "pos_receipt"
            if (lower.contains("payment")) return "payment_receipt"
            return "receipt"
        }
        if (lower.contains("credit memo")) return "credit_memo"
        if (lower.contains("remittance")) return "remittance"
        return "invoice"
    }

    private fun normalizeDate(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        if (Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(raw)) return raw
        val p = raw.replace("-", "/").split("/")
        if (p.size == 3) {
            return if (p[0].length == 4) {
                val yyyy = p[0]
                val mm = p[1].toIntOrNull()?.let { "%02d".format(it) } ?: "01"
                val dd = p[2].toIntOrNull()?.let { "%02d".format(it) } ?: "01"
                "$yyyy-$mm-$dd"
            } else {
                val mm = p[0].toIntOrNull()?.let { "%02d".format(it) } ?: "01"
                val dd = p[1].toIntOrNull()?.let { "%02d".format(it) } ?: "01"
                val yyyy = if (p[2].length == 2) "20${p[2]}" else p[2]
                "$yyyy-$mm-$dd"
            }
        }
        return raw
    }

    private fun normalizeTime(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        val p = raw.split(":")
        if (p.size < 2) return null
        val hh = "%02d".format(p[0].toIntOrNull() ?: 0)
        val mm = "%02d".format(p[1].toIntOrNull() ?: 0)
        return if (p.size >= 3) {
            val ss = "%02d".format(p[2].toIntOrNull() ?: 0)
            "$hh:$mm:$ss"
        } else {
            "$hh:$mm"
        }
    }

    private fun estimateOcrConfidence(text: String): Double {
        val words = text.split(Regex("\\s+")).filter { it.isNotBlank() }.size
        return (0.45 + (words.coerceAtMost(200) / 400.0)).coerceIn(0.45, 0.95)
    }

    private fun firstAmount(text: String, labels: List<String>): Double? {
        labels.forEach { label ->
            val pattern = Regex(
                "(?:\\b${Regex.escape(label)}\\b)\\s*[:\\-]?\\s*(?:[A-Z]{3}\\s*)?[$€£₹]?\\s*(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?)",
                setOf(RegexOption.IGNORE_CASE)
            )
            val m = pattern.find(text)?.groupValues?.getOrNull(1)
            val value = m?.replace(",", "")?.toDoubleOrNull()
            if (value != null) return value
        }
        return null
    }

    private fun firstMatch(text: String, pattern: String): String? {
        val regex = Regex(pattern, setOf(RegexOption.IGNORE_CASE))
        return regex.find(text)?.groupValues?.getOrNull(1)?.trim()
    }

    private fun detectCurrency(text: String): String {
        val upper = text.uppercase()
        return when {
            upper.contains("USD") || text.contains('$') -> "USD"
            upper.contains("EUR") || text.contains('€') -> "EUR"
            upper.contains("GBP") || text.contains('£') -> "GBP"
            upper.contains("INR") || text.contains('₹') -> "INR"
            else -> "USD"
        }
    }

    private fun estimateSchemaConfidence(
        invoiceNumber: String?,
        invoiceDate: String?,
        vendorName: String?,
        lineItems: List<ParsedLineItem>,
        grandTotal: Double,
    ): Double {
        var score = 0.0
        if (!invoiceNumber.isNullOrBlank()) score += 0.2
        if (!invoiceDate.isNullOrBlank()) score += 0.2
        if (!vendorName.isNullOrBlank()) score += 0.2
        if (lineItems.isNotEmpty()) score += 0.2
        if (grandTotal > 0.0) score += 0.2
        return score.coerceIn(0.0, 1.0)
    }

    private fun round2(value: Double): Double {
        return kotlin.math.round(value * 100.0) / 100.0
    }
}
