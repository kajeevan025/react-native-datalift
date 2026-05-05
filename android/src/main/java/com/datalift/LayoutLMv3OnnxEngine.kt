package com.datalift

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtException
import ai.onnxruntime.OrtSession
import android.graphics.Bitmap
import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer
import kotlin.math.max
import kotlin.math.min

class LayoutLMv3OnnxEngine {
  private val minimumTokenConfidence = 0.88

  data class Prediction(
    val used: Boolean,
    val runtime: String,
    val confidence: Double,
    val fields: Map<String, Any>,
    val warnings: List<String>,
  )

  private var env: OrtEnvironment? = null
  private var session: OrtSession? = null
  private var loadedModelPath: String? = null

  private fun getEnv(): OrtEnvironment {
    if (env == null) env = OrtEnvironment.getEnvironment()
    return env!!
  }

  private fun getSession(modelPath: String): OrtSession {
    if (session != null && loadedModelPath == modelPath) return session!!
    session?.close()
    val options = OrtSession.SessionOptions()
    session = getEnv().createSession(modelPath, options)
    loadedModelPath = modelPath
    return session!!
  }

  fun predict(
    modelPath: String,
    labelsPath: String?,
    text: String,
    image: Bitmap?,
    // 512 matches iOS CoreML shape and avoids truncation with BPE subword tokens
    maxSeqLen: Int = 512,
    imageSize: Int = 224,
  ): Prediction {
    val modelFile = File(modelPath)
    if (!modelFile.exists()) {
      throw IllegalArgumentException("LayoutLMv3 model file not found: $modelPath")
    }
    val session = try {
      getSession(modelPath)
    } catch (e: OrtException) {
      throw IllegalStateException("Failed to load ONNX session: ${e.message}", e)
    }

    // Load labels — null/missing path falls back to built-in defaults automatically.
    // If the downloaded file is incompatible, also fall back to defaults so extraction
    // still runs rather than failing the whole stage.
    val labelsResolved = labelsPath?.takeIf { it.isNotBlank() }
    val rawLabels = loadLabels(labelsResolved)
    val labels = if (isValidLabelMap(rawLabels)) rawLabels else defaultLabels()
    val bpeVocab = loadVocab(modelFile.parentFile)
    val encoded = encode(text, bpeVocab, maxSeqLen)
    val pixelValues = imageToTensorData(image, imageSize)

    // Use actual sequence length for ONNX dynamic shapes
    val actualSeqLen = encoded.inputIds.size.toLong()

    val inputs = mutableMapOf<String, OnnxTensor>()
    val inputIdsTensor = OnnxTensor.createTensor(
      getEnv(),
      LongBuffer.wrap(encoded.inputIds),
      longArrayOf(1, actualSeqLen),
    )
    val attentionTensor = OnnxTensor.createTensor(
      getEnv(),
      LongBuffer.wrap(encoded.attentionMask),
      longArrayOf(1, actualSeqLen),
    )
    val bboxTensor = OnnxTensor.createTensor(
      getEnv(),
      LongBuffer.wrap(encoded.bbox),
      longArrayOf(1, actualSeqLen, 4),
    )
    val imageTensor = OnnxTensor.createTensor(
      getEnv(),
      FloatBuffer.wrap(pixelValues),
      longArrayOf(1, 3, imageSize.toLong(), imageSize.toLong()),
    )

    val tokenTypeTensor = OnnxTensor.createTensor(
      getEnv(),
      LongBuffer.wrap(LongArray(actualSeqLen.toInt()) { 0L }),
      longArrayOf(1, actualSeqLen),
    )

    try {
      for (name in session.inputNames) {
        when {
          name.equals("input_ids", true) -> inputs[name] = inputIdsTensor
          name.equals("attention_mask", true) -> inputs[name] = attentionTensor
          name.equals("bbox", true) -> inputs[name] = bboxTensor
          name.equals("pixel_values", true) -> inputs[name] = imageTensor
          name.equals("token_type_ids", true) -> inputs[name] = tokenTypeTensor
        }
      }

      val results = session.run(inputs)
      val logitsCandidate = results.firstOrNull()?.value
      val logits = logitsCandidate?.let { extract3DLogits(it) }
        ?: throw IllegalStateException(
          "Model output does not contain token logits. Use a LayoutLMv3 token-classification ONNX model.",
        )

      val entities = decodeEntities(logits, encoded.tokens, labels)
      val fields = entitiesToFields(entities)

      val confidence = entities.maxOfOrNull { it.score } ?: 0.0
      val warnings = mutableListOf<String>()
      if (entities.isEmpty()) {
        warnings += "No high-confidence entities survived post-processing"
      }
      if (fields.isEmpty()) {
        warnings += "No validated schema fields could be derived from model predictions"
      }

      return Prediction(
        used = fields.isNotEmpty(),
        runtime = "onnxruntime-android",
        confidence = confidence,
        fields = fields,
        warnings = warnings,
      )
    } finally {
      resultsSafeClose(inputs)
    }
  }

  private fun resultsSafeClose(inputs: Map<String, OnnxTensor>) {
    inputs.values.forEach {
      try {
        it.close()
      } catch (_: Exception) {
      }
    }
  }

  // ── BPE vocab types ────────────────────────────────────────────────────────
  private data class MergePair(val a: String, val b: String)

  private data class BPEVocab(val vocab: Map<String, Int>, val mergeRanks: Map<MergePair, Int>)

  private data class Encoded(
    val inputIds: LongArray,
    val attentionMask: LongArray,
    val bbox: LongArray,
    val tokens: List<String>,
  )

  /** Encode OCR text using RoBERTa byte-level BPE with line/word-aware bounding boxes. */
  private fun encode(text: String, bpeVocab: BPEVocab, maxSeqLen: Int): Encoded {
    val rawLines = text.split("\n")
    val lines = rawLines.map { line ->
      line.split(" ").filter { it.isNotBlank() }
    }.filter { it.isNotEmpty() }
    val totalLines = max(1, lines.size)

    // RoBERTa special IDs: <s>=0  <pad>=1  </s>=2  <unk>=3
    val bos = 0L
    val eos = 2L

    val tokenIds   = mutableListOf(bos)
    val flatBbox   = mutableListOf(0L, 0L, 0L, 0L)
    val tokenStrs  = mutableListOf("<s>")

    outer@ for ((lineIdx, lineWords) in lines.withIndex()) {
      val wordsInLine = max(1, lineWords.size)
      val y0 = (lineIdx * 1000L) / totalLines
      val y1 = ((lineIdx + 1) * 1000L) / totalLines
      for ((wordIdx, word) in lineWords.withIndex()) {
        val x0 = (wordIdx * 1000L) / wordsInLine
        val x1 = ((wordIdx + 1) * 1000L) / wordsInLine
        val subtokens = bpeTokenize(word, isFirstWord = wordIdx == 0, bpeVocab = bpeVocab)
        for (subtoken in subtokens) {
          if (tokenIds.size >= maxSeqLen - 1) break@outer
          tokenIds += (bpeVocab.vocab[subtoken] ?: 3).toLong()
          flatBbox += listOf(x0, y0, x1, y1)
          tokenStrs += subtoken
        }
      }
    }

    if (tokenIds.size < maxSeqLen) {
      tokenIds += eos
      flatBbox += listOf(0L, 0L, 0L, 0L)
      tokenStrs += "</s>"
    }

    val seqLen  = tokenIds.size
    val ids     = LongArray(maxSeqLen) { 1L }  // pad_id = 1
    val mask    = LongArray(maxSeqLen) { 0L }
    val bbox    = LongArray(maxSeqLen * 4) { 0L }

    for (i in 0 until seqLen) {
      ids[i]          = tokenIds[i]
      mask[i]         = 1L
      bbox[i * 4]     = flatBbox[i * 4]
      bbox[i * 4 + 1] = flatBbox[i * 4 + 1]
      bbox[i * 4 + 2] = flatBbox[i * 4 + 2]
      bbox[i * 4 + 3] = flatBbox[i * 4 + 3]
    }

    return Encoded(inputIds = ids, attentionMask = mask, bbox = bbox, tokens = tokenStrs)
  }

  /** Byte-level BPE tokeniser. Non-first words in a line get a Ġ (U+0120) prefix. */
  private fun bpeTokenize(word: String, isFirstWord: Boolean, bpeVocab: BPEVocab): List<String> {
    if (word.isEmpty()) return emptyList()
    val prefixed = if (isFirstWord) word else "\u0120$word"
    if (bpeVocab.vocab.containsKey(prefixed)) return listOf(prefixed)

    val symbols: MutableList<String> = if (isFirstWord) {
      word.map { it.toString() }.toMutableList()
    } else {
      val chars = word.map { it.toString() }.toMutableList()
      if (chars.isNotEmpty()) chars[0] = "\u0120${chars[0]}"
      chars
    }
    if (symbols.isEmpty()) return emptyList()

    while (symbols.size > 1) {
      var bestRank = Int.MAX_VALUE
      var bestIdx  = -1
      for (i in 0 until symbols.size - 1) {
        val pair = MergePair(symbols[i], symbols[i + 1])
        val rank = bpeVocab.mergeRanks[pair] ?: continue
        if (rank < bestRank) { bestRank = rank; bestIdx = i }
      }
      if (bestIdx < 0) break
      symbols[bestIdx] = symbols[bestIdx] + symbols[bestIdx + 1]
      symbols.removeAt(bestIdx + 1)
    }
    return symbols
  }

  private fun imageToTensorData(bitmap: Bitmap?, imageSize: Int): FloatArray {
    val out = FloatArray(3 * imageSize * imageSize) { 0f }
    if (bitmap == null) return out

    val scaled = Bitmap.createScaledBitmap(bitmap, imageSize, imageSize, true)
    val mean = floatArrayOf(0.485f, 0.456f, 0.406f)
    val std = floatArrayOf(0.229f, 0.224f, 0.225f)

    var idxR = 0
    var idxG = imageSize * imageSize
    var idxB = 2 * imageSize * imageSize

    for (y in 0 until imageSize) {
      for (x in 0 until imageSize) {
        val p = scaled.getPixel(x, y)
        val r = Color.red(p) / 255f
        val g = Color.green(p) / 255f
        val b = Color.blue(p) / 255f
        out[idxR++] = (r - mean[0]) / std[0]
        out[idxG++] = (g - mean[1]) / std[1]
        out[idxB++] = (b - mean[2]) / std[2]
      }
    }

    return out
  }

  private data class Entity(val label: String, val text: String, val score: Double)

  private fun decodeEntities(
    logits: Array<Array<FloatArray>>,
    tokens: List<String>,
    labels: Map<Int, String>,
  ): List<Entity> {
    val entities = mutableListOf<Entity>()
    if (logits.isEmpty() || logits[0].isEmpty()) return entities

    val seq = logits[0]
    val limit = min(seq.size, tokens.size)
    for (i in 0 until limit) {
      val probs = softmax(seq[i])
      val (labelId, score) = probs.withIndex().maxByOrNull { it.value }?.let {
        it.index to it.value.toDouble()
      } ?: continue

      val labelRaw = labels[labelId] ?: "O"
      // Skip RoBERTa special tokens (<s>, </s>, <pad>) and Outside label
      if (labelRaw == "O" || tokens[i] == "<s>" || tokens[i] == "</s>" || tokens[i] == "<pad>") continue
      if (score.toDouble() < minimumTokenConfidence) continue
      val label = labelRaw.removePrefix("B-").removePrefix("I-")
      val cleaned = sanitizeEntityToken(tokens[i])
      if (cleaned.isBlank()) continue
      entities += Entity(label = label, text = cleaned, score = score)
    }
    return mergeEntities(entities)
  }

  private fun mergeEntities(entities: List<Entity>): List<Entity> {
    if (entities.isEmpty()) return emptyList()
    val merged = mutableListOf<Entity>()
    var current = entities.first()
    for (i in 1 until entities.size) {
      val next = entities[i]
      if (next.label == current.label) {
        current = current.copy(
          text = "${current.text} ${next.text}".trim(),
          score = max(current.score, next.score),
        )
      } else {
        merged += current
        current = next
      }
    }
    merged += current
    return merged
  }

  private fun entitiesToFields(entities: List<Entity>): Map<String, Any> {
    val fields = mutableMapOf<String, Any>()
    fun setField(key: String, value: Any) { if (!fields.containsKey(key)) fields[key] = value }

    // line item accumulation
    val lineItems = mutableListOf<MutableMap<String, Any>>()
    var currentItem = mutableMapOf<String, Any>()
    fun flushItem() {
      if (currentItem.isNotEmpty() && (currentItem.containsKey("description") || currentItem.containsKey("unit_price"))) {
        lineItems.add(currentItem)
        currentItem = mutableMapOf()
      }
    }

    for (entity in entities) {
      val label = entity.label.uppercase()
      when (label) {
        // ── Identifiers ──────────────────────────────────────────────
        "INVOICE_NUMBER"  -> normalizeIdentifier(entity.text)?.let { setField("invoice_number", it) }
        "RECEIPT_NUMBER"  -> normalizeIdentifier(entity.text)?.let { setField("receipt_number", it) }
        "ORDER_NUMBER"    -> normalizeIdentifier(entity.text)?.let { setField("order_number", it) }
        "PO_NUMBER"       -> normalizeIdentifier(entity.text)?.let { setField("po_number", it) }
        // ── Dates ────────────────────────────────────────────────────
        "DATE"            -> normalizeDate(entity.text)?.let { setField("date_issued", it) }
        "DUE_DATE"        -> normalizeDate(entity.text)?.let { setField("due_date", it) }
        // ── Vendor ───────────────────────────────────────────────────
        "VENDOR_NAME"     -> normalizeVendorName(entity.text)?.let { setField("vendor_name", it) }
        "VENDOR_ADDRESS"  -> entity.text.trim().takeIf { it.length >= 5 }?.let { setField("vendor_address", it) }
        // ── Buyer ────────────────────────────────────────────────────
        "BUYER_NAME"      -> normalizeVendorName(entity.text)?.let { setField("buyer_name", it) }
        "BUYER_ADDRESS"   -> entity.text.trim().takeIf { it.length >= 5 }?.let { setField("buyer_address", it) }
        // ── Totals ───────────────────────────────────────────────────
        "GRAND_TOTAL"     -> parseAmount(entity.text)?.let { fields["grand_total"] = it }
        "SUBTOTAL"        -> parseAmount(entity.text)?.let { fields["sub_total"] = it }
        "TOTAL_TAX"       -> parseAmount(entity.text)?.let { fields["total_tax"] = it }
        "AMOUNT_DUE"      -> parseAmount(entity.text)?.let { fields["amount_due"] = it }
        // ── Payment ──────────────────────────────────────────────────
        "PAYMENT_METHOD"  -> entity.text.trim().takeIf { it.length >= 2 }?.let { setField("payment_method", it) }
        // ── Line items ───────────────────────────────────────────────
        "ITEM_DESCRIPTION" -> {
          flushItem()
          currentItem["description"] = entity.text.trim()
        }
        "ITEM_QUANTITY" -> {
          val qty = entity.text.replace("[^0-9.]".toRegex(), "").toDoubleOrNull()
          if (qty != null) currentItem["quantity"] = qty
        }
        "ITEM_UNIT_PRICE" -> parseAmount(entity.text)?.let { currentItem["unit_price"] = it }
        "ITEM_TOTAL"      -> parseAmount(entity.text)?.let { currentItem["total"] = it }
      }
    }

    flushItem()
    if (lineItems.isNotEmpty()) fields["line_items"] = lineItems

    return fields
  }

  private fun parseAmount(raw: String): Double? {
    val n = raw.replace("[^0-9.-]".toRegex(), "").toDoubleOrNull()
    if (n == null || n <= 0.0 || n > 10_000_000.0) return null
    return n
  }

  private fun normalizeIdentifier(raw: String): String? {
    val cleaned = raw.uppercase().replace("[^A-Z0-9\\-/]".toRegex(), "")
    if (cleaned.length !in 2..40) return null
    if (!cleaned.any { it.isDigit() }) return null
    return cleaned
  }

  private fun normalizeDate(raw: String): String? {
    val m = Regex("(\\d{1,4}[/-]\\d{1,2}[/-]\\d{1,4})").find(raw)?.groupValues?.get(1)
    return m
  }

  private fun normalizeVendorName(raw: String): String? {
    val cleaned = raw.replace("[^A-Za-z0-9 &.,'-]".toRegex(), " ").replace("\\s+".toRegex(), " ").trim()
    if (cleaned.length < 3) return null
    val alphaCount = cleaned.count { it.isLetter() }
    if (alphaCount < 3) return null
    return cleaned
  }

  private fun sanitizeEntityToken(raw: String): String {
    return raw.replace("[^A-Za-z0-9$.,:/#&()\\-]".toRegex(), "").trim()
  }

  /**
   * Returns true if [labels] is a valid BIO token-classification label map:
   * must have at least an Outside ("O") label and one or more B- prefixed entities.
   * Domain-specific keywords are NOT required — any BIO labeled file is accepted.
   */
  private fun isValidLabelMap(labels: Map<Int, String>): Boolean {
    if (labels.isEmpty()) return false
    val normalized = labels.values.map { it.uppercase() }
    val hasOutside = normalized.any { it == "O" }
    val hasBioLabel = normalized.any { it.startsWith("B-") || it.startsWith("I-") }
    return hasOutside && hasBioLabel
  }

  // Keep for compatibility — callers that want a throwing variant can use this.
  private fun validateLabelMap(labels: Map<Int, String>) {
    if (!isValidLabelMap(labels)) {
      throw IllegalArgumentException(
        "LayoutLMv3 labels file appears incompatible. Provide token-classification labels with O/B-/I- tags for invoice entities.",
      )
    }
  }

  private fun softmax(values: FloatArray): FloatArray {
    val maxVal = values.maxOrNull() ?: 0f
    val exps = FloatArray(values.size)
    var sum = 0.0
    for (i in values.indices) {
      val e = kotlin.math.exp((values[i] - maxVal).toDouble())
      exps[i] = e.toFloat()
      sum += e
    }
    if (sum <= 0.0) return FloatArray(values.size) { 0f }
    for (i in exps.indices) exps[i] = (exps[i] / sum.toFloat())
    return exps
  }

  @Suppress("UNCHECKED_CAST")
  private fun extract3DLogits(value: Any): Array<Array<FloatArray>>? {
    return when (value) {
      is Array<*> -> {
        val first = value.firstOrNull() ?: return null
        if (first is Array<*> && first.firstOrNull() is FloatArray) {
          value as Array<Array<FloatArray>>
        } else if (first is FloatArray) {
          arrayOf(value as Array<FloatArray>)
        } else {
          null
        }
      }
      else -> null
    }
  }

  private fun loadLabels(labelsPath: String?): Map<Int, String> {
    if (labelsPath.isNullOrBlank()) return defaultLabels()
    val file = File(labelsPath)
    if (!file.exists()) return defaultLabels()

    val text = file.readText()

    // 1. Try JSON object formats:
    //    a) {"0": "O", "1": "B-INVOICE_NUMBER", ...}  — standard DataLift format
    //    b) {"id2label": {"0": "O", ...}, ...}          — HuggingFace config.json wrapper
    try {
      val json = JSONObject(text)
      val inner: JSONObject = if (json.has("id2label")) json.getJSONObject("id2label") else json
      val map = mutableMapOf<Int, String>()
      for (key in inner.keys()) {
        val k = key.toIntOrNull() ?: continue
        map[k] = inner.optString(key)
      }
      if (map.isNotEmpty()) return map
    } catch (_: Exception) { /* fall through */ }

    // 2. Try JSON array format: ["O", "B-INVOICE_NUMBER", ...]
    try {
      val arr = JSONArray(text)
      val map = mutableMapOf<Int, String>()
      for (i in 0 until arr.length()) {
        val v = arr.optString(i)
        if (v.isNotBlank()) map[i] = v
      }
      if (map.isNotEmpty()) return map
    } catch (_: Exception) { /* fall through */ }

    // 3. Plain-text fallback: one label per line, strip any residual JSON syntax
    val lines = file.readLines().mapIndexedNotNull { index, line ->
      val trimmed = line.trim()
        .removePrefix("\"")
        .removeSuffix("\",")
        .removeSuffix("\"")
        .trim()
      if (trimmed.isEmpty() || trimmed == "[" || trimmed == "]") null else index to trimmed
    }.toMap()
    return lines.ifEmpty { defaultLabels() }
  }

  /** Load RoBERTa vocab.json and merges.txt from model directory. */
  private fun loadVocab(modelDir: File?): BPEVocab {
    if (modelDir == null) return BPEVocab(emptyMap(), emptyMap())

    // vocab.json: {"Ġthe": 262, "Ġinvoice": 17208, ...}
    val vocab = mutableMapOf<String, Int>()
    val vocabFile = File(modelDir, "vocab.json")
    if (vocabFile.exists()) {
      try {
        val json = JSONObject(vocabFile.readText())
        for (key in json.keys()) vocab[key] = json.getInt(key)
      } catch (_: Exception) { /* leave empty */ }
    }

    // merges.txt: one "a b" pair per line, line index = merge priority
    val mergeRanks = mutableMapOf<MergePair, Int>()
    val mergesFile = File(modelDir, "merges.txt")
    if (mergesFile.exists()) {
      var rank = 0
      for (line in mergesFile.readLines()) {
        val t = line.trim()
        if (t.startsWith("#") || t.isEmpty()) continue
        val parts = t.split(" ", limit = 2)
        if (parts.size == 2) mergeRanks[MergePair(parts[0], parts[1])] = rank++
      }
    }

    return BPEVocab(vocab = vocab, mergeRanks = mergeRanks)
  }

  // ::: Code Generated by Copilot a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d. This comment will be removed automatically after the file is saved :::
  /** Default label map matching the fine-tuned LayoutLMv3 model in datalift-models/labels.json. */
  private fun defaultLabels(): Map<Int, String> = mapOf(
    0 to "O",
    1 to "B-INVOICE_NUMBER",
    2 to "I-INVOICE_NUMBER",
    3 to "B-RECEIPT_NUMBER",
    4 to "I-RECEIPT_NUMBER",
    5 to "B-DATE",
    6 to "I-DATE",
    7 to "B-DUE_DATE",
    8 to "I-DUE_DATE",
    9 to "B-VENDOR_NAME",
    10 to "I-VENDOR_NAME",
    11 to "B-VENDOR_ADDRESS",
    12 to "I-VENDOR_ADDRESS",
    13 to "B-BUYER_NAME",
    14 to "I-BUYER_NAME",
    15 to "B-BUYER_ADDRESS",
    16 to "I-BUYER_ADDRESS",
    17 to "B-PO_NUMBER",
    18 to "I-PO_NUMBER",
    19 to "B-ORDER_NUMBER",
    20 to "I-ORDER_NUMBER",
    21 to "B-GRAND_TOTAL",
    22 to "I-GRAND_TOTAL",
    23 to "B-SUBTOTAL",
    24 to "I-SUBTOTAL",
    25 to "B-TOTAL_TAX",
    26 to "I-TOTAL_TAX",
    27 to "B-AMOUNT_DUE",
    28 to "I-AMOUNT_DUE",
    29 to "B-ITEM_DESCRIPTION",
    30 to "I-ITEM_DESCRIPTION",
    31 to "B-ITEM_QUANTITY",
    32 to "I-ITEM_QUANTITY",
    33 to "B-ITEM_UNIT_PRICE",
    34 to "I-ITEM_UNIT_PRICE",
    35 to "B-ITEM_TOTAL",
    36 to "I-ITEM_TOTAL",
    37 to "B-PAYMENT_METHOD",
    38 to "I-PAYMENT_METHOD",
  )

}
