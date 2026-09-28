// [RESEARCH-1259] never merged
import { requireNativeModule } from "expo";

type Rss1259 = {
  footprint(): number;
  nativeHeap(): number;
  outputLatency(): number;
  ioBufferDuration(): number;
};

export default requireNativeModule<Rss1259>("Rss1259");
