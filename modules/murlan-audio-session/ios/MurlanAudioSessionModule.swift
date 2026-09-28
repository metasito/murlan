import AVFAudio
import ExpoModulesCore

public final class MurlanAudioSessionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MurlanAudioSession")

    Function("outputLatencyMs") { () -> Double in AVAudioSession.sharedInstance().outputLatency * 1000 }
    Function("ioBufferMs") { () -> Double in AVAudioSession.sharedInstance().ioBufferDuration * 1000 }
    Function("preferLowLatency") { try? AVAudioSession.sharedInstance().setPreferredIOBufferDuration(0.005) }
  }
}
