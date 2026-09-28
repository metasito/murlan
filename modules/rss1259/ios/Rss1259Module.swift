// [RESEARCH-1259] never merged
import AVFoundation
import ExpoModulesCore

public class Rss1259Module: Module {
  public func definition() -> ModuleDefinition {
    Name("Rss1259")

    Function("footprint") { () -> Double in
      var info = task_vm_info_data_t()
      var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
      let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
      }
      return kr == KERN_SUCCESS ? Double(info.phys_footprint) : -1
    }

    Function("nativeHeap") { () -> Double in
      return -1
    }

    Function("outputLatency") { () -> Double in
      return AVAudioSession.sharedInstance().outputLatency
    }

    Function("ioBufferDuration") { () -> Double in
      return AVAudioSession.sharedInstance().ioBufferDuration
    }
  }
}
