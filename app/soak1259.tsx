// [RESEARCH-1259] never merged
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Asset } from "expo-asset";
import { AudioContext, type AudioBuffer, type AudioBufferSourceNode, type GainNode } from "react-native-audio-api";
import { triggerHaptics } from "react-native-turbo-haptics";
import Rss1259 from "@/modules/rss1259";
import { stopMusic } from "@/lib/device/music";
import { FontSize, Spacing } from "@/lib/theme";

const SOUNDS = [
  require("@/assets/sounds/bomb.mp3"),
  require("@/assets/sounds/clock_running_out.mp3"),
  require("@/assets/sounds/combo.mp3"),
  require("@/assets/sounds/deal.mp3"),
  require("@/assets/sounds/exchange.mp3"),
  require("@/assets/sounds/manche_lost.mp3"),
  require("@/assets/sounds/manche_won.mp3"),
  require("@/assets/sounds/partita_lost.mp3"),
  require("@/assets/sounds/partita_won.mp3"),
  require("@/assets/sounds/pass.mp3"),
  require("@/assets/sounds/play.mp3"),
  require("@/assets/sounds/reconnected.mp3"),
  require("@/assets/sounds/reject.mp3"),
  require("@/assets/sounds/room_full.mp3"),
  require("@/assets/sounds/round_start.mp3"),
  require("@/assets/sounds/round_win.mp3"),
  require("@/assets/sounds/seat_fill.mp3"),
  require("@/assets/sounds/select.mp3"),
  require("@/assets/sounds/turn.mp3"),
];

const TRACKS = [
  require("@/assets/music/flac/menu.flac"),
  require("@/assets/music/flac/hand.flac"),
  require("@/assets/music/flac/cue.flac"),
];

const PLAY_EVERY_MS = 1250;
const CROSSFADE_EVERY_MS = 60_000;
const SAMPLE_EVERY_MS = 10_000;
const FADE_S = 0.6;

type Row = { t: number; k: string; [field: string]: unknown };

declare const HermesInternal: { getInstrumentedStats?: () => Record<string, number> } | undefined;

function hermesHeap(): Record<string, number> {
  const stats = typeof HermesInternal !== "undefined" ? HermesInternal?.getInstrumentedStats?.() : undefined;
  return stats ? { jsHeap: stats.js_heapSize, jsAllocated: stats.js_allocatedBytes } : {};
}

async function decode(ctx: AudioContext, mod: number): Promise<AudioBuffer> {
  const asset = await Asset.fromModule(mod).downloadAsync();
  if (!asset.localUri) throw new Error(`no localUri for ${asset.name}`);
  return ctx.decodeAudioData(asset.localUri);
}

export default function Soak1259() {
  const params = useLocalSearchParams<{ arm?: string; host?: string }>();
  const arm = params.arm === "effects" ? "effects" : "full";
  const host = params.host ?? "127.0.0.1";
  const [status, setStatus] = useState("starting");

  useEffect(() => {
    const session = `${arm}-${Date.now().toString(36)}`;
    const started = Date.now();
    const pending: Row[] = [];
    const timers: ReturnType<typeof setInterval>[] = [];
    let seq = 0;
    let plays = 0;
    let crossfades = 0;
    let disconnects = 0;
    let lastState = "";
    let closed = false;
    const elapsed = () => (Date.now() - started) / 1000;
    const log = (k: string, fields: Record<string, unknown> = {}) => {
      pending.push({ t: Date.now(), k, el: elapsed(), ...fields });
      if (pending.length > 500) pending.splice(0, pending.length - 500);
    };
    const flush = async () => {
      const rows = pending.splice(0, pending.length);
      if (rows.length === 0) return;
      try {
        await fetch(`http://${host}:5099/log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session, seq: seq++, rows }),
        });
      } catch (e) {
        pending.unshift(...rows);
        setStatus(`post failed: ${String(e)}`);
      }
    };

    stopMusic();
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const sfxBus = ctx.createGain();
    sfxBus.connect(master);
    const musicBus = ctx.createGain();
    musicBus.gain.value = 0.6;
    musicBus.connect(master);

    const sample = () => {
      let footprint = -1;
      let nativeHeap = -1;
      let outputLatency = -1;
      let ioBufferDuration = -1;
      try {
        footprint = Rss1259.footprint();
        nativeHeap = Rss1259.nativeHeap();
        outputLatency = Rss1259.outputLatency();
        ioBufferDuration = Rss1259.ioBufferDuration();
      } catch (e) {
        log("error", { where: "rss1259", message: String(e) });
      }
      log("sample", {
        arm,
        plays,
        crossfades,
        disconnects,
        footprint,
        nativeHeap,
        ...hermesHeap(),
        state: ctx.state,
        currentTime: ctx.currentTime,
        outputLatency,
        ioBufferDuration,
      });
      setStatus(`${arm} ${Math.round(elapsed())}s plays=${plays} xf=${crossfades} state=${ctx.state} fp=${Math.round(footprint / 1048576)}MB`);
    };

    const watchState = () => {
      if (ctx.state !== lastState) {
        log("state", { from: lastState, to: ctx.state, currentTime: ctx.currentTime });
        lastState = ctx.state;
      }
    };

    const playEffect = (effects: AudioBuffer[]) => {
      try {
        const buffer = effects[Math.floor(Math.random() * effects.length)];
        const rate = 1 + (Math.random() * 0.08 - 0.04);
        const src: AudioBufferSourceNode = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = rate;
        const voice = ctx.createGain();
        src.connect(voice);
        voice.connect(sfxBus);
        src.start(ctx.currentTime);
        plays++;
        setTimeout(() => {
          voice.disconnect();
          disconnects++;
        }, (buffer.duration / rate) * 1000 + 250);
        triggerHaptics("selection");
      } catch (e) {
        log("error", { where: "playEffect", message: String(e) });
      }
    };

    let music: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
    let trackIndex = 0;
    const crossfade = (tracks: AudioBuffer[]) => {
      try {
        const now = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = tracks[trackIndex % tracks.length];
        src.loop = true;
        trackIndex++;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(1, now + FADE_S);
        src.connect(gain);
        gain.connect(musicBus);
        src.start(now);
        const old = music;
        if (old) {
          old.gain.gain.setValueAtTime(1, now);
          old.gain.gain.linearRampToValueAtTime(0, now + FADE_S);
          setTimeout(() => {
            old.src.stop();
            old.gain.disconnect();
          }, FADE_S * 1000 + 50);
          crossfades++;
        }
        music = { src, gain };
      } catch (e) {
        log("error", { where: "crossfade", message: String(e) });
      }
    };

    const boot = async () => {
      log("boot", { arm, host, state: ctx.state });
      watchState();
      timers.push(setInterval(watchState, 500));
      timers.push(setInterval(() => void flush(), SAMPLE_EVERY_MS));
      await flush();
      await ctx.resume();
      watchState();
      const effects = await Promise.all(SOUNDS.map((m) => decode(ctx, m)));
      const tracks = arm === "full" ? await Promise.all(TRACKS.map((m) => decode(ctx, m))) : [];
      if (closed) return;
      log("decoded", {
        effects: effects.length,
        tracks: tracks.length,
        sampleRate: ctx.sampleRate,
        trackSeconds: tracks.map((b) => b.duration),
      });
      sample();
      await flush();
      timers.push(setInterval(sample, SAMPLE_EVERY_MS));
      timers.push(setInterval(() => playEffect(effects), PLAY_EVERY_MS));
      if (arm === "full") {
        crossfade(tracks);
        timers.push(setInterval(() => crossfade(tracks), CROSSFADE_EVERY_MS));
      }
      setTimeout(stopMusic, 5000);
    };

    boot().catch((e) => {
      log("error", { where: "boot", message: String(e), stack: e instanceof Error ? e.stack : undefined });
      setStatus(`boot failed: ${String(e)}`);
      void flush();
    });

    return () => {
      closed = true;
      timers.forEach(clearInterval);
      void ctx.close();
    };
  }, [arm, host]);

  return (
    <View style={{ flex: 1, backgroundColor: "#031008", alignItems: "center", justifyContent: "center", padding: Spacing.lg }}>
      <Text style={{ color: "#fff", fontSize: FontSize.xl }}>SOAK1259</Text>
      <Text style={{ color: "#fff", marginTop: Spacing.md }}>{status}</Text>
    </View>
  );
}
