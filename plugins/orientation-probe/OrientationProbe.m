// Throwaway probe for #1211. Removed before landing.
#import <UIKit/UIKit.h>
#import <objc/runtime.h>
#import <mach-o/dyld.h>

static __thread BOOL OPQuiet = NO;
static NSMutableDictionary<NSString *, NSNumber *> *OPCounts;

static NSString *OPMask(NSUInteger m) {
  NSMutableArray *p = [NSMutableArray array];
  if (m & UIInterfaceOrientationMaskPortrait) [p addObject:@"Pu"];
  if (m & UIInterfaceOrientationMaskPortraitUpsideDown) [p addObject:@"Pd"];
  if (m & UIInterfaceOrientationMaskLandscapeLeft) [p addObject:@"Ll"];
  if (m & UIInterfaceOrientationMaskLandscapeRight) [p addObject:@"Lr"];
  return [NSString stringWithFormat:@"0x%lx(%@)", (unsigned long)m, [p componentsJoinedByString:@" "]];
}

static NSString *OPStack(void) {
  NSArray *s = [NSThread callStackSymbols];
  NSRange r = NSMakeRange(2, MIN((NSUInteger)18, s.count > 2 ? s.count - 2 : 0));
  NSMutableArray *out = [NSMutableArray array];
  for (NSString *line in [s subarrayWithRange:r]) {
    NSString *t = [line stringByReplacingOccurrencesOfString:@"  +" withString:@" " options:NSRegularExpressionSearch range:NSMakeRange(0, line.length)];
    [out addObject:t];
  }
  return [out componentsJoinedByString:@" | "];
}

static void OPLog(NSString *text) {
  static NSUInteger seq = 0;
  NSUInteger id_ = ++seq;
  NSUInteger chunk = 700;
  for (NSUInteger i = 0, part = 0; i < text.length; i += chunk, part++) {
    NSString *piece = [text substringWithRange:NSMakeRange(i, MIN(chunk, text.length - i))];
    NSLog(@"ORIPROBE[%lu.%lu] %@", (unsigned long)id_, (unsigned long)part, piece);
  }
}

static void OPDumpVC(UIViewController *vc, int depth, NSMutableString *out) {
  if (!vc || depth > 12) return;
  [out appendFormat:@" %*s%@<%p>=%@", depth, "", NSStringFromClass([vc class]), vc, OPMask([vc supportedInterfaceOrientations])];
  if (vc.presentedViewController && vc.presentedViewController.presentingViewController == vc) {
    [out appendString:@" [presented:"];
    OPDumpVC(vc.presentedViewController, depth + 1, out);
    [out appendString:@"]"];
  }
  for (UIViewController *c in vc.childViewControllers) OPDumpVC(c, depth + 1, out);
}

static void OPDump(NSString *why) {
  OPQuiet = YES;
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:UIWindowScene.class]) continue;
    UIWindowScene *ws = (UIWindowScene *)scene;
    NSMutableString *out = [NSMutableString string];
    [out appendFormat:@"ORIPROBE dump(%@) sceneIO=%ld", why, (long)ws.interfaceOrientation];
    for (UIWindow *w in ws.windows) {
      [out appendFormat:@" || window %@<%p> key=%d hidden=%d level=%.0f frame=%@ root:", NSStringFromClass(w.class), w, w.isKeyWindow, w.hidden, w.windowLevel, NSStringFromCGRect(w.frame)];
      OPDumpVC(w.rootViewController, 0, out);
    }
    OPLog(out);
  }
  OPQuiet = NO;
}

static void OPReport(NSString *key, NSString *what) {
  NSUInteger n = OPCounts[key].unsignedIntegerValue + 1;
  OPCounts[key] = @(n);
  if (n <= 25) {
    OPLog([NSString stringWithFormat:@"%@ #%lu stack: %@", what, (unsigned long)n, OPStack()]);
  } else if (n % 50 == 0) {
    NSLog(@"ORIPROBE %@ #%lu (stack suppressed)", what, (unsigned long)n);
  }
}

// Wraps a no-argument getter returning an orientation mask; logs every result with no landscape bit.
static void OPWrapMaskGetter(Class cls, SEL sel) {
  Method m = class_getInstanceMethod(cls, sel);
  if (!m) return;
  typedef NSUInteger (*Fn)(id, SEL);
  Fn orig = (Fn)method_getImplementation(m);
  NSString *owner = NSStringFromClass(cls);
  NSString *selName = NSStringFromSelector(sel);
  IMP wrapped = imp_implementationWithBlock(^NSUInteger(id self) {
    NSUInteger r = orig(self, sel);
    if (!OPQuiet && r != 0 && !(r & (UIInterfaceOrientationMaskLandscapeLeft | UIInterfaceOrientationMaskLandscapeRight))) {
      OPQuiet = YES;
      NSString *what = [NSString stringWithFormat:@"portrait-only -[%@ %@] self=%@<%p> -> %@", owner, selName, NSStringFromClass([self class]), self, OPMask(r)];
      OPReport([owner stringByAppendingString:selName], what);
      OPQuiet = NO;
    }
    return r;
  });
  class_replaceMethod(cls, sel, wrapped, method_getTypeEncoding(m));
  NSLog(@"ORIPROBE wrapped -[%@ %@]", owner, selName);
}

static BOOL OPIsMaskGetter(Method m) {
  NSString *name = NSStringFromSelector(method_getName(m));
  if ([name rangeOfString:@"upportedInterfaceOrientation"].location == NSNotFound &&
      [name rangeOfString:@"OrientationMask"].location == NSNotFound &&
      [name rangeOfString:@"rientationPreferences"].location == NSNotFound) return NO;
  if ([name containsString:@":"]) return NO;
  char ret[16];
  method_getReturnType(m, ret, sizeof ret);
  return (ret[0] == 'Q' || ret[0] == 'q') && method_getNumberOfArguments(m) == 2;
}

static void OPWrapOwnMaskGetters(Class cls) {
  unsigned int n = 0;
  Method *ms = class_copyMethodList(cls, &n);
  NSMutableArray<NSString *> *sels = [NSMutableArray array];
  for (unsigned int i = 0; i < n; i++) {
    if (OPIsMaskGetter(ms[i])) [sels addObject:NSStringFromSelector(method_getName(ms[i]))];
  }
  free(ms);
  for (NSString *s in sels) OPWrapMaskGetter(cls, NSSelectorFromString(s));
}

static void OPLogSelectorsMatching(Class cls, NSString *needle) {
  unsigned int n = 0;
  Method *ms = class_copyMethodList(cls, &n);
  NSMutableArray *names = [NSMutableArray array];
  for (unsigned int i = 0; i < n; i++) {
    NSString *s = NSStringFromSelector(method_getName(ms[i]));
    if ([s rangeOfString:needle options:NSCaseInsensitiveSearch].location != NSNotFound) [names addObject:s];
  }
  free(ms);
  OPLog([NSString stringWithFormat:@"selectors %@ ~%@: %@", NSStringFromClass(cls), needle, [names componentsJoinedByString:@" "]]);
}

static void OPWrapVoidLogging(Class cls, SEL sel, NSString *label) {
  Method m = class_getInstanceMethod(cls, sel);
  if (!m) return;
  typedef void (*Fn)(id, SEL);
  Fn orig = (Fn)method_getImplementation(m);
  IMP wrapped = imp_implementationWithBlock(^(id self) {
    OPLog([NSString stringWithFormat:@"%@ by %@<%p> stack: %@", label, NSStringFromClass([self class]), self, OPStack()]);
    orig(self, sel);
    dispatch_async(dispatch_get_main_queue(), ^{ OPDump(label); });
  });
  class_replaceMethod(cls, sel, wrapped, method_getTypeEncoding(m));
}

@interface OrientationProbe : NSObject
@end

@implementation OrientationProbe

+ (void)load {
  OPCounts = [NSMutableDictionary dictionary];

  NSString *appDir = [@"/" stringByAppendingString:[[NSBundle.mainBundle.bundlePath lastPathComponent] stringByAppendingString:@"/"]];
  for (uint32_t i = 0; i < _dyld_image_count(); i++) {
    const char *img = _dyld_get_image_name(i);
    if (!img || !strstr(img, appDir.UTF8String)) continue;
    unsigned int n = 0;
    const char **names = objc_copyClassNamesForImage(img, &n);
    for (unsigned int j = 0; j < n; j++) {
      Class c = objc_getClass(names[j]);
      if (c) OPWrapOwnMaskGetters(c);
    }
    free(names);
  }

  for (NSString *name in @[ @"UIViewController", @"UINavigationController", @"UITabBarController",
                            @"UISplitViewController", @"UIAlertController", @"UIWindow", @"UIWindowScene",
                            @"UIApplication", @"UIPresentationController", @"UIInputWindowController" ]) {
    Class c = NSClassFromString(name);
    if (c) OPWrapOwnMaskGetters(c);
  }
  OPLogSelectorsMatching(UIWindowScene.class, @"rientation");
  OPLogSelectorsMatching(UIWindow.class, @"rientation");

  OPWrapVoidLogging(UIViewController.class, NSSelectorFromString(@"setNeedsUpdateOfSupportedInterfaceOrientations"), @"setNeedsUpdateOfSupportedInterfaceOrientations");

  {
    SEL sel = NSSelectorFromString(@"requestGeometryUpdateWithPreferences:errorHandler:");
    Method m = class_getInstanceMethod(UIWindowScene.class, sel);
    if (m) {
      typedef void (*Fn)(id, SEL, id, id);
      Fn orig = (Fn)method_getImplementation(m);
      IMP wrapped = imp_implementationWithBlock(^(id me, id prefs, id handler) {
        NSUInteger mask = [prefs respondsToSelector:NSSelectorFromString(@"interfaceOrientations")] ? [[prefs valueForKey:@"interfaceOrientations"] unsignedIntegerValue] : 0;
        OPLog([NSString stringWithFormat:@"requestGeometryUpdate %@ stack: %@", OPMask(mask), OPStack()]);
        orig(me, sel, prefs, handler);
      });
      class_replaceMethod(UIWindowScene.class, sel, wrapped, method_getTypeEncoding(m));
    }
  }

  {
    SEL sel = @selector(setRootViewController:);
    Method m = class_getInstanceMethod(UIWindow.class, sel);
    typedef void (*Fn)(id, SEL, id);
    Fn orig = (Fn)method_getImplementation(m);
    IMP wrapped = imp_implementationWithBlock(^(UIWindow *me, UIViewController *vc) {
      NSLog(@"ORIPROBE setRootViewController window=%@<%p> vc=%@<%p>", NSStringFromClass(me.class), me, NSStringFromClass(vc.class), vc);
      orig(me, sel, vc);
    });
    class_replaceMethod(UIWindow.class, sel, wrapped, method_getTypeEncoding(m));
  }

  [NSNotificationCenter.defaultCenter addObserverForName:UIWindowDidBecomeKeyNotification object:nil queue:nil usingBlock:^(NSNotification *note) {
    UIWindow *w = note.object;
    NSLog(@"ORIPROBE key window -> %@<%p> root=%@", NSStringFromClass(w.class), w, NSStringFromClass(w.rootViewController.class));
  }];
  [NSNotificationCenter.defaultCenter addObserverForName:UIWindowDidBecomeVisibleNotification object:nil queue:nil usingBlock:^(NSNotification *note) {
    UIWindow *w = note.object;
    NSLog(@"ORIPROBE window visible %@<%p> level=%.0f root=%@", NSStringFromClass(w.class), w, w.windowLevel, NSStringFromClass(w.rootViewController.class));
  }];
  [NSNotificationCenter.defaultCenter addObserverForName:UIDeviceOrientationDidChangeNotification object:nil queue:nil usingBlock:^(NSNotification *note) {
    NSLog(@"ORIPROBE device orientation -> %ld", (long)UIDevice.currentDevice.orientation);
    dispatch_async(dispatch_get_main_queue(), ^{ OPDump(@"deviceOrientation"); });
  }];
  [NSNotificationCenter.defaultCenter addObserverForName:UIApplicationDidFinishLaunchingNotification object:nil queue:nil usingBlock:^(NSNotification *note) {
    id<UIApplicationDelegate> d = UIApplication.sharedApplication.delegate;
    SEL sel = @selector(application:supportedInterfaceOrientationsForWindow:);
    Class cls = [(NSObject *)d class];
    Method m = class_getInstanceMethod(cls, sel);
    NSLog(@"ORIPROBE app delegate %@ implements supportedInterfaceOrientationsForWindow: %d", NSStringFromClass(cls), m != NULL);
    if (!m) return;
    typedef NSUInteger (*Fn)(id, SEL, id, id);
    Fn orig = (Fn)method_getImplementation(m);
    IMP wrapped = imp_implementationWithBlock(^NSUInteger(id me, UIApplication *app, UIWindow *w) {
      NSUInteger r = orig(me, sel, app, w);
      if (!OPQuiet && !(r & (UIInterfaceOrientationMaskLandscapeLeft | UIInterfaceOrientationMaskLandscapeRight))) {
        OPReport(@"appDelegateMask", [NSString stringWithFormat:@"portrait-only app delegate mask for window %@<%p> -> %@", NSStringFromClass(w.class), w, OPMask(r)]);
      }
      return r;
    });
    class_replaceMethod(cls, sel, wrapped, method_getTypeEncoding(m));
  }];
}

@end
