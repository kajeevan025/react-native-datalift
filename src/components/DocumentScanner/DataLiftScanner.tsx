/**
 * DataLift Scanner UI Component
 *
 * Full-featured document scanner component with built-in camera/gallery UI,
 * multi-image support, and real-time preview.
 *
 * @example
 * ```tsx
 * <DataLiftScanner
 *   onResults={(results) => console.log(results)}
 *   multiImage={true}
 *   maxImages={5}
 *   showPreview={true}
 * />
 * ```
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
  Pressable,
} from "react-native";
import {
  launchCamera,
  launchImageLibrary,
  Asset,
} from "react-native-image-picker";
import { useDataLift } from "../../hooks";
import { DocumentScanResult, ImageQuality, DataLiftError } from "../../types";
import { styles } from "./styles";

// ============================================================================
// TYPES
// ============================================================================

export interface DataLiftScannerProps {
  /** Callback when single/multiple results are ready */
  onResults?: (results: DocumentScanResult[]) => void;
  /** Error callback */
  onError?: (error: Error) => void;
  /** Enable multi-image selection */
  multiImage?: boolean;
  /** Max images for multi-select (default: 10) */
  maxImages?: number;
  /** Image quality */
  quality?: ImageQuality;
  /** OCR language */
  language?: string;
  /** Enable debug logs */
  enableDebug?: boolean;
  /** Document types filter */
  docTypes?: string[];
  /** Show results preview */
  showPreview?: boolean;
  /** Custom button labels */
  labels?: {
    camera?: string;
    gallery?: string;
    processing?: string;
  };
}

interface ProcessedImage {
  id: string;
  uri: string;
  result?: DocumentScanResult;
  error?: string;
  loading: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Full-featured UI component for document scanning with multi-image support.
 *
 * Provides camera capture, gallery picker, image preview, and automatic processing.
 * Can handle single or multiple images at once.
 */
export const DataLiftScanner: React.FC<DataLiftScannerProps> = ({
  onResults,
  onError,
  multiImage = false,
  maxImages = 10,
  quality = ImageQuality.MEDIUM,
  language = "eng",
  enableDebug = false,
  docTypes,
  showPreview = true,
  labels,
}) => {
  // State
  const [images, setImages] = useState<ProcessedImage[]>([]);

  // Hook
  const dataLift = useDataLift({
    language,
    enableDebug,
    confidenceThreshold: 0.7,
  });

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  /**
   * Handle image processing completion.
   *
   * Uses the functional form of setImages (prev) so we always read the
   * LATEST state — fixing the stale-closure bug where images was always [].
   * When all images are done, onResults is fired via setTimeout to avoid
   * calling a prop callback inside a setState updater.
   */
  const handleImageProcessed = useCallback(
    (id: string, result?: DocumentScanResult, error?: string) => {
      setImages((prev) => {
        const updated = prev.map((img) =>
          img.id === id ? { ...img, result, error, loading: false } : img,
        );

        // Fire onResults when every image has finished processing
        const allDone = updated.every((img) => !img.loading);
        if (allDone && onResults) {
          const allResults = updated
            .map((img) => img.result)
            .filter((r): r is DocumentScanResult => !!r);

          if (allResults.length > 0) {
            // Defer outside the setState call
            setTimeout(() => onResults(allResults), 0);
          }
        }

        return updated;
      });
    },
    [onResults],
  );

  /**
   * Process multiple images sequentially.
   */
  const processImages = useCallback(
    async (assets: Asset[]) => {
      const newImages: ProcessedImage[] = assets
        .filter((asset) => asset.uri)
        .map((asset) => ({
          id: asset.uri || `${Date.now()}-${Math.random()}`,
          uri: asset.uri!,
          loading: true,
        }));

      if (newImages.length === 0) return;

      setImages((prev) => [...prev, ...newImages]);

      // Process each image sequentially to avoid overwhelming the OCR engine
      for (const img of newImages) {
        try {
          const result = await dataLift.processImage(img.uri, {
            documentType: docTypes?.[0],
          });
          handleImageProcessed(img.id, result);
        } catch (err) {
          const errorMsg =
            err instanceof Error ? err.message : "Processing failed";
          handleImageProcessed(img.id, undefined, errorMsg);
          onError?.(err instanceof Error ? err : new Error(errorMsg));
        }
      }
    },
    [dataLift, docTypes, handleImageProcessed, onError],
  );

  /**
   * Handle camera capture
   */
  const handleCameraCapture = useCallback(() => {
    launchCamera(
      {
        mediaType: "photo",
        cameraType: "back",
        quality: quality === ImageQuality.HIGH ? 1 : 0.7,
      },
      async (response) => {
        if (response.didCancel) return;
        if (response.errorCode) {
          const err = new DataLiftError(
            response.errorMessage || "Camera error",
            `CAMERA_${response.errorCode}`,
          );
          onError?.(err);
          Alert.alert("Camera Error", err.message);
          return;
        }
        if (response.assets) {
          await processImages(response.assets);
        }
      },
    );
  }, [quality, processImages, onError]);

  /**
   * Handle gallery selection
   */
  const handleGalleryPick = useCallback(() => {
    launchImageLibrary(
      {
        mediaType: "photo",
        selectionLimit: multiImage ? maxImages : 1,
      },
      async (response) => {
        if (response.didCancel) return;
        if (response.errorCode) {
          const err = new DataLiftError(
            response.errorMessage || "Gallery error",
            `GALLERY_${response.errorCode}`,
          );
          onError?.(err);
          Alert.alert("Gallery Error", err.message);
          return;
        }
        if (response.assets) {
          await processImages(response.assets);
        }
      },
    );
  }, [multiImage, maxImages, processImages, onError]);

  /**
   * Remove an image from the list
   */
  const handleRemoveImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================

  const hasProcessingImages = images.some((img) => img.loading);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[
              styles.button,
              hasProcessingImages && styles.buttonDisabled,
            ]}
            onPress={handleCameraCapture}
            activeOpacity={0.7}
            disabled={hasProcessingImages}
          >
            <Text style={styles.buttonIcon}>📷</Text>
            <Text style={styles.buttonText}>
              {labels?.camera || "Capture Document"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.button,
              styles.buttonSecondary,
              hasProcessingImages && styles.buttonDisabled,
            ]}
            onPress={handleGalleryPick}
            activeOpacity={0.7}
            disabled={hasProcessingImages}
          >
            <Text style={styles.buttonIcon}>🖼️</Text>
            <Text style={styles.buttonText}>
              {labels?.gallery ||
                (multiImage ? "Pick Images" : "Pick from Gallery")}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Processing Indicator */}
        {hasProcessingImages && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0066cc" />
            <Text style={styles.loadingText}>
              {labels?.processing || "Processing documents..."}{" "}
              {Math.round(dataLift.progress)}%
            </Text>
          </View>
        )}

        {/* Image Preview Grid */}
        {showPreview && images.length > 0 && (
          <ScrollView
            style={styles.previewContainer}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.previewGrid}>
              {images.map((img) => (
                <View key={img.id} style={styles.previewItem}>
                  <Image
                    source={{ uri: img.uri }}
                    style={styles.previewImage}
                  />

                  {img.loading && (
                    <View style={styles.previewOverlay}>
                      <ActivityIndicator color="#fff" />
                    </View>
                  )}

                  {img.error && (
                    <View style={[styles.previewOverlay, styles.errorOverlay]}>
                      <Text style={styles.errorText}>❌</Text>
                    </View>
                  )}

                  {img.result && (
                    <View style={styles.resultBadge}>
                      <Text style={styles.resultText}>
                        {img.result.documentType || "✓"}
                      </Text>
                    </View>
                  )}

                  <Pressable
                    style={styles.removeButton}
                    onPress={() => handleRemoveImage(img.id)}
                  >
                    <Text style={styles.removeButtonText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        {/* Info Text */}
        {images.length === 0 && !hasProcessingImages && (
          <View style={styles.infoContainer}>
            <Text style={styles.infoText}>
              {multiImage
                ? `Capture or select up to ${maxImages} documents to process`
                : "Capture or select a document to process"}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

/**
 * Backward-compatible alias
 */
export const DocumentScanner = DataLiftScanner;
