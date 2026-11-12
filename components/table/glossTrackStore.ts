// Whether the fans' gloss is drawn as one picture or by the backs, held outside React so a settle renders the fans' gloss alone.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { SharedValue } from "react-native-reanimated";
import { nextFanLight, type GlossLight } from "./cardGloss.ts";
import { glossRested, restLight } from "./restEnds.ts";
import type { Lamp, LampNow } from "./lampRig.ts";

export type LightReader = Readonly<Pick<SharedValue<GlossLight>, "value" | "get">>;

export interface GlossTracks {
  /** The light where the lamp rests, written at each settle: a back whose gloss the fan draws reads its foil glint there. */
  rest: SharedValue<GlossLight>;
  /** The light a back drawn live reads while the lamp moves, posed from the rig's lamp by `follow`. */
  light: LightReader;
  /** The felt's `EndsProps.side`: while it shows an end of a rested lamp, the rig may stop stepping it (`endsCarry`). */
  ends: SharedValue<number>;
  /** The rig's lamp as it is now (`LampRig.now`), which the tracks are baked and steered from. */
  rig: LampNow;
  /** The lamp as it was when it last settled or a track last ran out, a copy: the fans bake anew from it when it changes. */
  get(): Lamp;
  subscribe(listener: () => void): () => void;
  /** True while the lamp glides, flares, is kicked or dims: the backs are then drawn live, as the mockup's `gloss()`, and the fans' gloss rests. */
  live(): boolean;
  rebake(): void;
  /** Called with every frame the rig steps: the only writer of `live`, `rest` and `light`. */
  follow(lamp: Lamp): void;
}

type Aim = Pick<Lamp, "tx" | "ty" | "tr" | "lvlT">;
const aimOf = ({ tx, ty, tr, lvlT }: Lamp): Aim => ({ tx, ty, tr, lvlT });
const sameAim = (a: Aim, b: Aim) => a.tx === b.tx && a.ty === b.ty && a.tr === b.tr && a.lvlT === b.lvlT;

export function createGlossTracks(rig: LampNow, { rest, light, ends }: { rest: SharedValue<GlossLight>; light: SharedValue<GlossLight>; ends: SharedValue<number> }, resting: Lamp): GlossTracks {
  let taken = resting;
  let live = !glossRested(resting);
  let aim = aimOf(resting);
  const listeners = new Set<() => void>();
  const tell = () => {
    taken = structuredClone(rig.now());
    for (const listener of listeners) listener();
  };
  const update = (rested: boolean) => {
    live = !rested;
    tell();
    if (rested) rest.value = restLight(taken);
  };
  const pose = (lamp: GlossLight) => {
    if (!live) return;
    const next = nextFanLight(light.value, lamp);
    if (next) light.value = next;
  };
  return {
    rest,
    light,
    ends,
    rig,
    get: () => taken,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    live: () => live,
    rebake: tell,
    follow: (lamp) => {
      const rested = glossRested(lamp);
      if (rested === live || (rested && !sameAim(aim, lamp))) {
        aim = aimOf(lamp);
        update(rested);
      }
      pose(lamp);
    },
  };
}
