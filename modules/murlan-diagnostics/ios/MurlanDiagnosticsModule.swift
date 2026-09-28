import AVFAudio
import CoreMotion
import ExpoModulesCore
import QuartzCore
import ReplayKit

public final class MurlanDiagnosticsModule: Module {
  private let queue = DispatchQueue(label: "murlan.diagnostics")
  private var rows: [[String: Any]] = []
  private var appOnsets = OnsetDetector(source: "app", levels: true)
  private var micOnsets = OnsetDetector(source: "mic", levels: false)
  private var shakes = ShakeDetector()
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

    Function("outputLatencyMs") { () -> Double in AVAudioSession.sharedInstance().outputLatency * 1000 }
    Function("ioBufferMs") { () -> Double in AVAudioSession.sharedInstance().ioBufferDuration * 1000 }
    Function("inputLatencyMs") { () -> Double in AVAudioSession.sharedInstance().inputLatency * 1000 }

    AsyncFunction("startCapture") { (mic: Bool, promise: Promise) in
      let recorder = RPScreenRecorder.shared()
      recorder.isMicrophoneEnabled = mic
      recorder.startCapture(handler: { [weak self] buffer, type, error in
        guard let self, error == nil else { return }
        switch type {
        case .audioApp: self.queue.async { self.rows.append(contentsOf: self.appOnsets.feed(buffer)) }
        case .audioMic: self.queue.async { self.rows.append(contentsOf: self.micOnsets.feed(buffer)) }
        default: return
        }
      }, completionHandler: { error in
        if let error { promise.reject("E_CAPTURE", error.localizedDescription) } else { promise.resolve(true) }
      })
    }

    AsyncFunction("stopCapture") { (promise: Promise) in
      RPScreenRecorder.shared().stopCapture { _ in promise.resolve(true) }
    }

    Function("startMotion") { () -> Bool in
      guard self.motion.isAccelerometerAvailable else { return false }
      self.motion.accelerometerUpdateInterval = 0.01
      let operations = OperationQueue()
      operations.underlyingQueue = self.queue
      self.motion.startAccelerometerUpdates(to: operations) { [weak self] data, _ in
        guard let self, let data else { return }
        let a = data.acceleration
        self.rows.append(contentsOf: self.shakes.feed(t: data.timestamp * 1000, x: a.x, y: a.y, z: a.z))
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
}
