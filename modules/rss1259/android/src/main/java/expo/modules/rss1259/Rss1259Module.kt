// [RESEARCH-1259] never merged
package expo.modules.rss1259

import android.os.Debug
import android.system.Os
import android.system.OsConstants
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class Rss1259Module : Module() {
  override fun definition() = ModuleDefinition {
    Name("Rss1259")

    Function("footprint") {
      val residentPages = File("/proc/self/statm").readText().trim().split(Regex("\\s+"))[1].toLong()
      (residentPages * Os.sysconf(OsConstants._SC_PAGESIZE)).toDouble()
    }

    Function("nativeHeap") {
      Debug.getNativeHeapAllocatedSize().toDouble()
    }

    Function("outputLatency") {
      -1.0
    }

    Function("ioBufferDuration") {
      -1.0
    }
  }
}
