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

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
