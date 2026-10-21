#import "MurlanReactNativeFlags.h"

#import <memory>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/featureflags/ReactNativeFeatureFlagsOverridesOSSStable.h>

using namespace facebook::react;

namespace {
// The stable release level `ExpoReactNativeFactory` chose (app.json sets none), and this one flag.
class StableWithSwiftUIFilters : public ReactNativeFeatureFlagsOverridesOSSStable {
 public:
  bool enableSwiftUIBasedFilters() override
  {
    return true;
  }
};
} // namespace

@implementation MurlanReactNativeFlags

+ (void)enableSwiftUIFilters
{
  ReactNativeFeatureFlags::dangerouslyForceOverride(std::make_unique<StableWithSwiftUIFilters>());
}

@end
