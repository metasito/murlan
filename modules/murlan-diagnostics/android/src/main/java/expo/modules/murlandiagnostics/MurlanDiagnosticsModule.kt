package expo.modules.murlandiagnostics

import android.system.Os
import android.system.OsConstants
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class MurlanDiagnosticsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MurlanDiagnostics")

    Function("hostNowMs") { System.nanoTime() / 1e6 }

    Function("footprintMb") {
      val pages = File("/proc/self/statm").readText().trim().split(" ")[1].toLong()
      pages * Os.sysconf(OsConstants._SC_PAGESIZE) / 1048576.0
    }
  }
}
