#import <React/RCTBridgeModule.h>

/**
 * Objective-C bridge for the DataLift Swift native module.
 * Exposes all methods to the React Native JavaScript layer.
 * Compatible with React Native 0.70+ (both old and new architecture)
 */
@interface RCT_EXTERN_MODULE(DataLift, NSObject)

RCT_EXTERN_METHOD(
  classifyDocument:(NSDictionary *)options
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
  extractTextNative:(NSDictionary *)options
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
  extractPDFPages:(NSDictionary *)options
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
  extractInvoiceSchema:(NSDictionary *)options
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
  configureLayoutLMv3:(NSDictionary *)options
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
  predictLayoutLMv3:(NSDictionary *)options
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
  checkLayoutLMv3Compatibility:(NSDictionary *)options
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
  getModelStorageDir:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
  downloadModelFile:(NSDictionary *)options
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
