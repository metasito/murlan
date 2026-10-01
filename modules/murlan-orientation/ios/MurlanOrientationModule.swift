import ExpoModulesCore
import ObjectiveC
import QuartzCore
import UIKit

public final class MurlanOrientationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MurlanOrientation")

    AsyncFunction("holdLandscape") { LandscapeHold.shared.request() }.runOnQueue(.main)
    AsyncFunction("release") { LandscapeHold.shared.release() }.runOnQueue(.main)
    AsyncFunction("snapshot") { () -> [String: Any] in LandscapeHold.shared.snapshot() }.runOnQueue(.main)
  }
}

final class LandscapeHold {
  static let shared = LandscapeHold()
  private(set) var held = false
  private var delegatePatched = false
  private var requests = 0
  private var lastRequestMs = -1.0
  private var lastError = ""
  private var lastErrorMs = -1.0

  private var windowScenes: [UIWindowScene] {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
  }

  func request() {
    held = true
    patchDelegate()
    requests += 1
    lastRequestMs = CACurrentMediaTime() * 1000
    for scene in windowScenes {
      for window in scene.windows {
        for vc in presentedChain(window.rootViewController) { vc.setNeedsUpdateOfSupportedInterfaceOrientations() }
      }
      scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscape)) { error in
        DispatchQueue.main.async {
          LandscapeHold.shared.lastError = error.localizedDescription
          LandscapeHold.shared.lastErrorMs = CACurrentMediaTime() * 1000
        }
      }
    }
  }

  func release() {
    held = false
  }

  // expo-screen-orientation's delegate answers with the key window's root mask, and with no
  // orientation at all when no window is key; held, the answer always includes landscape.
  private func patchDelegate() {
    guard !delegatePatched, let delegate = UIApplication.shared.delegate, let cls = object_getClass(delegate) else { return }
    let sel = NSSelectorFromString("application:supportedInterfaceOrientationsForWindow:")
    guard let method = class_getInstanceMethod(cls, sel) else { return }
    delegatePatched = true
    typealias Mask = @convention(c) (AnyObject, Selector, UIApplication, UIWindow?) -> UInt
    let original = unsafeBitCast(method_getImplementation(method), to: Mask.self)
    let patched: @convention(block) (AnyObject, UIApplication, UIWindow?) -> UInt = { me, app, window in
      let mask = original(me, sel, app, window)
      return LandscapeHold.shared.held ? mask | UIInterfaceOrientationMask.landscape.rawValue : mask
    }
    let imp = imp_implementationWithBlock(patched)
    if !class_addMethod(cls, sel, imp, method_getTypeEncoding(method)) {
      method_setImplementation(method, imp)
    }
  }

  private func presentedChain(_ root: UIViewController?) -> [UIViewController] {
    var chain: [UIViewController] = []
    var vc = root
    while let next = vc {
      chain.append(next)
      vc = next.presentedViewController
    }
    return chain
  }

  func snapshot() -> [String: Any] {
    let app = UIApplication.shared
    let now = CACurrentMediaTime() * 1000
    let key = windowScenes.flatMap { $0.windows }.last { $0.isKeyWindow }
    var row: [String: Any] = [
      "held": held,
      "delegatePatched": delegatePatched,
      "requests": requests,
      "requestAgoMs": lastRequestMs < 0 ? -1 : now - lastRequestMs,
      "geometryError": lastError,
      "geometryErrorAgoMs": lastErrorMs < 0 ? -1 : now - lastErrorMs,
      "keyWindow": key != nil,
      "expoRequiredMask": expoRequiredMask(),
      "scenes": app.connectedScenes.map { scene(app, $0) },
    ]
    if let key {
      row["key"] = window(app, key)
      row["delegateMask"] = bits(app.delegate?.application?(app, supportedInterfaceOrientationsFor: key))
    }
    return row
  }

  private func scene(_ app: UIApplication, _ scene: UIScene) -> [String: Any] {
    var row: [String: Any] = ["state": stateName(scene.activationState)]
    if let windowScene = scene as? UIWindowScene {
      row["orientation"] = windowScene.interfaceOrientation.rawValue
      row["windows"] = windowScene.windows.map { window(app, $0) }
    }
    return row
  }

  private func window(_ app: UIApplication, _ window: UIWindow) -> [String: Any] {
    let chain = presentedChain(window.rootViewController)
    return [
      "isKey": window.isKeyWindow,
      "hidden": window.isHidden,
      "w": Double(window.bounds.width),
      "h": Double(window.bounds.height),
      "root": chain.first.map { String(reflecting: type(of: $0)) } ?? "",
      "rootMask": bits(chain.first?.supportedInterfaceOrientations),
      "top": chain.last.map { String(reflecting: type(of: $0)) } ?? "",
      "topMask": bits(chain.last?.supportedInterfaceOrientations),
      "appMask": bits(app.supportedInterfaceOrientations(for: window)),
    ]
  }

  private func bits(_ mask: UIInterfaceOrientationMask?) -> Int {
    mask.map { Int($0.rawValue) } ?? -1
  }

  private func stateName(_ state: UIScene.ActivationState) -> String {
    switch state {
    case .unattached: return "unattached"
    case .foregroundActive: return "foregroundActive"
    case .foregroundInactive: return "foregroundInactive"
    case .background: return "background"
    @unknown default: return "unknown"
    }
  }

  private func expoRequiredMask() -> Int {
    let sel = NSSelectorFromString("shared")
    guard let cls = NSClassFromString("ExpoScreenOrientation.ScreenOrientationRegistry"),
          let method = class_getClassMethod(cls, sel) else { return -1 }
    typealias Getter = @convention(c) (AnyObject, Selector) -> AnyObject?
    let registry = unsafeBitCast(method_getImplementation(method), to: Getter.self)(cls as AnyObject, sel)
    guard let registry = registry as? NSObject,
          registry.responds(to: NSSelectorFromString("requiredOrientationMask")) else { return -2 }
    return (registry.value(forKey: "requiredOrientationMask") as? NSNumber)?.intValue ?? -3
  }
}
