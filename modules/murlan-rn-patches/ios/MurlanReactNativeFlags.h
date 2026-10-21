#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface MurlanReactNativeFlags : NSObject

/**
 * Turns on React Native's SwiftUI view filters, which draw `grayscale()` on iOS. Call it on the main
 * thread after the React Native factory exists and before it starts: it swaps the flag store, which
 * nothing else may be reading then.
 */
+ (void)enableSwiftUIFilters;

@end

NS_ASSUME_NONNULL_END
