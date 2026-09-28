import AudioToolbox
import CoreMedia

struct OnsetDetector {
  let source: String
  let levels: Bool
  init(source: String, levels: Bool) { self.source = source; self.levels = levels }
  private var average = 1e-9
  private var lastOnset = -Double.infinity
  private var levelSum = 0.0
  private var levelCount = 0
  private var levelStart = -1.0

  mutating func feed(_ buffer: CMSampleBuffer) -> [[String: Any]] {
    guard let format = CMSampleBufferGetFormatDescription(buffer),
          let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee else { return [] }
    // ReplayKit stamps sample buffers on the host clock, the one hostNowMs reads.
    let t0 = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(buffer)) * 1000
    let samples = firstChannel(buffer, asbd)
    let rate = asbd.mSampleRate
    let window = max(1, Int(rate / 1000))
    var rows: [[String: Any]] = []
    var i = 0
    while i + window <= samples.count {
      var power = 0.0
      for s in samples[i..<(i + window)] { power += Double(s * s) }
      power /= Double(window)
      let t = t0 + Double(i) / rate * 1000
      let db = 10 * log10(power + 1e-12)
      if db > 10 * log10(average + 1e-12) + 12, db > -45, t - lastOnset > 50 {
        rows.append(["k": "onset", "host": t, "db": db, "source": source])
        lastOnset = t
      }
      average += (power - average) / 20
      guard levels else { i += window; continue }
      if levelStart < 0 { levelStart = t }
      levelSum += power
      levelCount += 1
      if t - levelStart >= 50 {
        rows.append(["k": "level", "host": levelStart, "db": 10 * log10(levelSum / Double(levelCount) + 1e-12)])
        levelSum = 0
        levelCount = 0
        levelStart = -1
      }
      i += window
    }
    return rows
  }

  private func firstChannel(_ buffer: CMSampleBuffer, _ asbd: AudioStreamBasicDescription) -> [Float] {
    var size = 0
    CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(buffer, bufferListSizeNeededOut: &size, bufferListOut: nil, bufferListSize: 0, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
    guard size > 0 else { return [] }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    let list = raw.bindMemory(to: AudioBufferList.self, capacity: 1)
    var block: CMBlockBuffer?
    guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(buffer, bufferListSizeNeededOut: nil, bufferListOut: list, bufferListSize: size, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block) == noErr else { return [] }
    let first = UnsafeMutableAudioBufferListPointer(list)[0]
    guard let data = first.mData, asbd.mBitsPerChannel > 0 else { return [] }
    let stride = Int(first.mNumberChannels)
    let count = Int(first.mDataByteSize) / Int(asbd.mBitsPerChannel / 8) / max(1, stride)
    let isFloat = asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0
    let bigEndian = asbd.mFormatFlags & kAudioFormatFlagIsBigEndian != 0
    var out = [Float](repeating: 0, count: count)
    if isFloat && asbd.mBitsPerChannel == 32 {
      let p = data.assumingMemoryBound(to: Float.self)
      for f in 0..<count { out[f] = p[f * stride] }
    } else if !isFloat && asbd.mBitsPerChannel == 16 {
      let p = data.assumingMemoryBound(to: Int16.self)
      for f in 0..<count { out[f] = Float(bigEndian ? Int16(bigEndian: p[f * stride]) : p[f * stride]) / 32768 }
    } else {
      return []
    }
    return out
  }
}

struct ShakeDetector {
  private var mean = 1.0
  private var last = -Double.infinity

  mutating func feed(t: Double, x: Double, y: Double, z: Double) -> [[String: Any]] {
    let g = (x * x + y * y + z * z).squareRoot()
    let deviation = abs(g - mean)
    mean += (g - mean) / 20
    guard deviation > 0.02, t - last > 100 else { return [] }
    last = t
    return [["k": "shake", "host": t, "g": deviation]]
  }
}
