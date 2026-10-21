#import <objc/runtime.h>
#import <React/RCTViewComponentView.h>
#import <react/renderer/core/LayoutMetrics.h>

using namespace facebook::react;

// React Native 0.86's prepareForRecycle resets `_layoutMetrics` to `{}`, a real layout (0,0,0,0, display flex):
// a recycled view next laid out at exactly that keeps its previous life's center, bounds and hidden (#1485).
// Only EmptyLayoutMetrics forces the next mount to apply them. The core links prebuilt, so the fix lives here,
// not in a patch; upstream it is react/react-native#57590, from 0.88.
@implementation RCTViewComponentView (MurlanRecycledLayout)

+ (void)load
{
  Method method = class_getInstanceMethod(self, @selector(prepareForRecycle));
  NSCAssert(method, @"RCTViewComponentView no longer has prepareForRecycle to wrap");
  auto original = (void (*)(id, SEL))method_getImplementation(method);
  method_setImplementation(method, imp_implementationWithBlock(^(RCTViewComponentView *view) {
    original(view, @selector(prepareForRecycle));
    [view murlan_forgetLayout];
  }));
}

- (void)murlan_forgetLayout
{
  _layoutMetrics = EmptyLayoutMetrics;
}

@end
