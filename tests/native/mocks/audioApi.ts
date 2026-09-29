export interface ParamEvent {
  kind: "set" | "ramp" | "target" | "cancel" | "hold";
  value: number;
  time: number;
}

export interface MockParam {
  value: number;
  events: ParamEvent[];
  setValueAtTime(v: number, t: number): MockParam;
  linearRampToValueAtTime(v: number, t: number): MockParam;
  setTargetAtTime(v: number, t: number, tau: number): MockParam;
  cancelScheduledValues(t: number): MockParam;
  cancelAndHoldAtTime(t: number): MockParam;
}

export interface MockBuffer {
  path: string;
  duration: number;
  sampleRate: number;
}

export interface MockNode {
  id: number;
  kind: "gain" | "source" | "destination";
  outputs: MockNode[];
  disconnected: boolean;
  gain: MockParam;
  playbackRate: MockParam;
  buffer: MockBuffer | null;
  loop: boolean;
  startedAt?: number;
  startedWith?: MockBuffer | null;
  stoppedAt?: number;
  onEnded?: unknown;
  connect(to: MockNode): MockNode;
  disconnect(): void;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AudioApiState {
  log: string[];
  session: unknown[];
  contexts: MockContext[];
  decoded: MockBuffer[];
  nextId: number;
  epoch: number;
  failResumes: number;
  failDecode: boolean;
  failSession: boolean;
  durationS: number;
}

export function audioApiState(): AudioApiState {
  const g = globalThis as { __audioApi?: AudioApiState };
  g.__audioApi ??= { log: [], session: [], contexts: [], decoded: [], nextId: 0, epoch: 0, failResumes: 0, failDecode: false, failSession: false, durationS: 1 };
  return g.__audioApi;
}

function param(value: number): MockParam {
  const p: MockParam = {
    value,
    events: [],
    setValueAtTime(v, t) { p.events.push({ kind: "set", value: v, time: t }); p.value = v; return p; },
    linearRampToValueAtTime(v, t) { p.events.push({ kind: "ramp", value: v, time: t }); return p; },
    setTargetAtTime(v, t) { p.events.push({ kind: "target", value: v, time: t }); return p; },
    cancelScheduledValues(t) { p.events.push({ kind: "cancel", value: NaN, time: t }); return p; },
    cancelAndHoldAtTime(t) { p.events.push({ kind: "hold", value: NaN, time: t }); return p; },
  };
  return p;
}

function node(kind: MockNode["kind"], ctx: MockContext | null): MockNode {
  const n: MockNode = {
    id: audioApiState().nextId++,
    kind,
    outputs: [],
    disconnected: false,
    gain: param(1),
    playbackRate: param(1),
    buffer: null,
    loop: false,
    connect(to) { n.outputs.push(to); return to; },
    disconnect() { n.disconnected = true; n.outputs = []; },
    start(when = 0) { n.startedAt = when; n.startedWith = n.buffer; },
    stop(when = 0) { n.stoppedAt = when; },
  };
  ctx?.nodes.push(n);
  return n;
}

export class MockContext {
  state: "running" | "suspended" | "closed" = "suspended";
  readonly sampleRate: number;
  readonly destination = node("destination", null);
  readonly nodes: MockNode[] = [];
  private frozenAt: number | null = null;

  constructor(options?: { sampleRate?: number }) {
    const s = audioApiState();
    s.log.push("context");
    this.sampleRate = options?.sampleRate ?? 44100;
    s.contexts.push(this);
  }
  get currentTime(): number {
    return this.frozenAt ?? performance.now() / 1000 + 10;
  }
  freeze(): void {
    this.frozenAt = this.currentTime;
  }
  async resume(): Promise<void> {
    const s = audioApiState();
    if (s.failResumes > 0) {
      s.failResumes--;
      throw new Error("resume refused");
    }
    this.state = "running";
  }
  async suspend(): Promise<void> {
    this.state = "suspended";
  }
  async close(): Promise<void> {
    this.state = "closed";
  }
  createGain(): MockNode {
    return node("gain", this);
  }
  createBufferSource(): MockNode {
    return node("source", this);
  }
}

export function newEpoch(): void {
  const s = audioApiState();
  s.epoch = s.nextId;
  s.failResumes = 0;
  s.failDecode = false;
  s.failSession = false;
  s.durationS = 1;
  s.log.length = 0;
  s.session.length = 0;
  for (const c of s.contexts) for (const n of c.nodes) { n.gain.events.length = 0; n.playbackRate.events.length = 0; }
}

export function audioApiModule() {
  const s = audioApiState();
  return {
    __esModule: true,
    AudioContext: MockContext,
    AudioManager: {
      setAudioSessionOptions: (o: unknown) => {
        if (s.failSession) throw new Error("session busy");
        s.log.push("session");
        s.session.push(o);
      },
      disableSessionManagement: () => s.log.push("disableSessionManagement"),
      observeAudioInterruptions: () => s.log.push("observeAudioInterruptions"),
    },
    decodeAudioData: async (input: string, sampleRate?: number): Promise<MockBuffer> => {
      if (s.failDecode) throw new Error("decode failed");
      const b = { path: input, duration: s.durationS, sampleRate: sampleRate ?? 48000 };
      s.decoded.push(b);
      return b;
    },
    __mock: s,
  };
}

export function audioSessionModule() {
  const s = audioApiState();
  return {
    __esModule: true,
    default: {
      outputLatencyMs: () => 8,
      ioBufferMs: () => 5,
      preferLowLatency: () => void s.log.push("preferLowLatency"),
    },
  };
}
