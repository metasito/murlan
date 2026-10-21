import AVFAudio
import CoreMotion
import ExpoModulesCore
import QuartzCore
import ReplayKit

public final class MurlanDiagnosticsModule: Module {
  private static let maxRows = 20_000
  private let queue = DispatchQueue(label: "murlan.diagnostics")
  private var rows: [[String: Any]] = []
  private var appOnsets = OnsetDetector(source: "app", levels: true)
  private var micOnsets = OnsetDetector(source: "mic", levels: false)
  private var shakes = ShakeDetector()
  private var capture = 0
  private var motionRun = 0
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

    Function("inputLatencyMs") { () -> Double in AVAudioSession.sharedInstance().inputLatency * 1000 }

    AsyncFunction("startCapture") { (mic: Bool, promise: Promise) in
      // Buffers the last capture still has queued would feed the fresh detectors.
      let run = self.queue.sync { () -> Int in
        self.capture += 1
        self.appOnsets = OnsetDetector(source: "app", levels: true)
        self.micOnsets = OnsetDetector(source: "mic", levels: false)
        return self.capture
      }
      let recorder = RPScreenRecorder.shared()
      recorder.isMicrophoneEnabled = mic
      recorder.startCapture(handler: { [weak self] buffer, type, error in
        guard let self, error == nil else { return }
        guard type == .audioApp || type == .audioMic else { return }
        self.queue.async {
          guard self.capture == run else { return }
          self.keep(type == .audioApp ? self.appOnsets.feed(buffer) : self.micOnsets.feed(buffer))
        }
      }, completionHandler: { error in
        if let error { promise.reject("E_CAPTURE", error.localizedDescription) } else { promise.resolve(true) }
      })
    }

    AsyncFunction("stopCapture") { (promise: Promise) in
      RPScreenRecorder.shared().stopCapture { error in
        if let error { promise.reject("E_CAPTURE", error.localizedDescription) } else { promise.resolve(true) }
      }
    }

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

  /// On `queue`.
  private func keep(_ new: [[String: Any]]) {
    rows.append(contentsOf: new)
    if rows.count > Self.maxRows { rows.removeFirst(rows.count - Self.maxRows * 9 / 10) }
  }
}
