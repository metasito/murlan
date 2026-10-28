import AVFAudio
import CoreMotion
import ExpoModulesCore
import Metal
import QuartzCore
import ReplayKit
import UIKit

public final class MurlanDiagnosticsModule: Module {
  private static let maxRows = 20_000
  private static let device = MTLCreateSystemDefaultDevice()
  private let queue = DispatchQueue(label: "murlan.diagnostics")
  private var rows: [[String: Any]] = []
  private var appOnsets = OnsetDetector(source: "app", levels: true)
  private var micOnsets = OnsetDetector(source: "mic", levels: false)
  private var shakes = ShakeDetector()
  private var capture = 0
  private var motionRun = 0
  private var display = (maxFps: 0, battery: Float(-1), charging: false)
  private let motion = CMMotionManager()

  public func definition() -> ModuleDefinition {
    Name("MurlanDiagnostics")

    Function("hostNowMs") { () -> Double in CACurrentMediaTime() * 1000 }

    Function("footprintMb") { () -> Double in
      var info = task_vm_info_data_t()
      var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
      let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
      }
      return kr == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : -1
    }

    Function("systemState") { () -> [String: Any] in
      let info = ProcessInfo.processInfo
      // UIKit answers on the main thread; a call from here must not wait for it, so it reads the last answer and asks for the next.
      DispatchQueue.main.async {
        UIDevice.current.isBatteryMonitoringEnabled = true
        let state = UIDevice.current.batteryState
        let now = (maxFps: UIScreen.main.maximumFramesPerSecond, battery: UIDevice.current.batteryLevel, charging: state == .charging || state == .full)
        self.queue.async { self.display = now }
      }
      let (maxFps, battery, charging) = self.queue.sync { self.display }
      return [
        "battery": Double(battery),
        "charging": charging,
        "thermal": info.thermalState.rawValue,
        "lowPower": info.isLowPowerModeEnabled,
        "maxFps": maxFps,
        "cpuMs": Self.cpuMs(),
        "gpuMb": Double(Self.device?.currentAllocatedSize ?? 0) / 1_048_576,
      ]
    }

    Function("inputLatencyMs") { () -> Double in AVAudioSession.sharedInstance().inputLatency * 1000 }

    // On main: ReplayKit presents its permission prompt from whichever queue asks.
    AsyncFunction("startCapture") { (mic: Bool, promise: Promise) in
      let recorder = RPScreenRecorder.shared()
      let begin = {
        // Buffers the last capture still has queued would feed the fresh detectors.
        let run = self.queue.sync { () -> Int in
          self.capture += 1
          self.appOnsets = OnsetDetector(source: "app", levels: true)
          self.micOnsets = OnsetDetector(source: "mic", levels: false)
          return self.capture
        }
        recorder.isMicrophoneEnabled = mic
        recorder.startCapture(handler: { [weak self] buffer, type, error in
          guard let self else { return }
          if let error {
            // The capture ended under the run (permission, backgrounding): a silent log would read as a missing sound.
            self.queue.async {
              guard self.capture == run else { return }
              self.keep([["k": "captureStopped", "host": CACurrentMediaTime() * 1000, "error": error.localizedDescription]])
            }
            return
          }
          guard type == .audioApp || type == .audioMic else { return }
          self.queue.async {
            guard self.capture == run else { return }
            self.keep(type == .audioApp ? self.appOnsets.feed(buffer) : self.micOnsets.feed(buffer))
          }
        }, completionHandler: { error in
          if let error { promise.reject("E_CAPTURE", error.localizedDescription) } else { promise.resolve(true) }
        })
      }
      // A capture left running by an aborted run would refuse the new one.
      if recorder.isRecording { recorder.stopCapture { _ in begin() } } else { begin() }
    }.runOnQueue(.main)

    AsyncFunction("stopCapture") { (promise: Promise) in
      RPScreenRecorder.shared().stopCapture { error in
        if let error { promise.reject("E_CAPTURE", error.localizedDescription) } else { promise.resolve(true) }
      }
    }.runOnQueue(.main)

    Function("startMotion") { () -> Bool in
      guard self.motion.isAccelerometerAvailable else { return false }
      let run = self.queue.sync { () -> Int in
        self.motionRun += 1
        self.shakes = ShakeDetector()
        return self.motionRun
      }
      self.motion.accelerometerUpdateInterval = 0.01
      let operations = OperationQueue()
      operations.underlyingQueue = self.queue
      self.motion.startAccelerometerUpdates(to: operations) { [weak self] data, _ in
        guard let self, let data, self.motionRun == run else { return }
        let a = data.acceleration
        self.keep(self.shakes.feed(t: data.timestamp * 1000, x: a.x, y: a.y, z: a.z))
      }
      return true
    }

    Function("stopMotion") { self.motion.stopAccelerometerUpdates() }

    Function("drain") { () -> [[String: Any]] in
      self.queue.sync {
        let out = self.rows
        self.rows = []
        return out
      }
    }
  }

  /// CPU time this process has used, every thread it has ever run, in ms; -1 when the kernel refuses.
  private static func cpuMs() -> Double {
    var live = task_thread_times_info_data_t()
    var liveCount = mach_msg_type_number_t(MemoryLayout<task_thread_times_info_data_t>.size / MemoryLayout<natural_t>.size)
    let a = withUnsafeMutablePointer(to: &live) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(liveCount)) {
        task_info(mach_task_self_, task_flavor_t(TASK_THREAD_TIMES_INFO), $0, &liveCount)
      }
    }
    var gone = mach_task_basic_info()
    var goneCount = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
    let b = withUnsafeMutablePointer(to: &gone) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(goneCount)) {
        task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &goneCount)
      }
    }
    guard a == KERN_SUCCESS, b == KERN_SUCCESS else { return -1 }
    func ms(_ t: time_value_t) -> Double { Double(t.seconds) * 1000 + Double(t.microseconds) / 1000 }
    return ms(live.user_time) + ms(live.system_time) + ms(gone.user_time) + ms(gone.system_time)
  }

  /// On `queue`.
  private func keep(_ new: [[String: Any]]) {
    rows.append(contentsOf: new)
    if rows.count > Self.maxRows {
      let cut = rows.count - Self.maxRows * 9 / 10
      rows.removeFirst(cut)
      rows.append(["k": "nativeDropped", "host": CACurrentMediaTime() * 1000, "n": cut])
    }
  }
}
