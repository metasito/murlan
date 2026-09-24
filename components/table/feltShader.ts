// The cloth (#1252 § The felt): the Lantern Table mockup's `FS`, ported line for line, as one body
// both a Skia runtime effect and the web fallback's WebGL bake compile. The body keeps GLSL's
// type names, which SkSL also accepts, so there is one copy of it (tests/ui-rules/feltWeave.test.ts).
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { FeltStops } from "../../lib/cosmetics.ts";

/** The worsted twill the owner picked (#1245): the mockup's `TWILL`, less its jacquard switch. */
export const TWILL = {
  uType: 1,
  uDepth: 0.42,
  uCover: 0.05,
  uFuzz: 0.05,
  uSheen: 1,
  uAniso: 14,
  uTwo: 0.03,
  uMott: 0.5,
  uPitch: 1.1 * 0.75,
} as const;

export const LAMP_HEIGHT = 200;

const UNIFORMS = `uniform vec2 uLamp;
uniform float uK,uLampH,uFlare,uPitch,uType,uDepth,uCover,uFuzz,uSheen,uAniso,uTwo,uMott;
uniform vec3 uS0,uS1,uS2,uS3,uS4;`;

export const CLOTH_BODY = `vec3 stops(float t){t=clamp(t,0.,1.)*4.;if(t<1.)return mix(uS0,uS1,t);if(t<2.)return mix(uS1,uS2,t-1.);if(t<3.)return mix(uS2,uS3,t-2.);return mix(uS3,uS4,t-3.);}
float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float h11(float n){return fract(sin(n*91.345+7.13)*47453.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}
bool warpOver(vec2 c,float jac){
 if(jac>.5)return mod(c.y*2.+c.x,5.)>.5;
 if(uType<.5)return mod(c.x+c.y,2.)<.5;
 if(uType<1.5)return mod(c.x+c.y,4.)<2.;
 if(uType<2.5)return mod(floor(c.x/2.)+floor(c.y/2.),2.)<.5;
 float s=mod(floor(c.x/6.),2.)<.5?c.x+c.y:c.y-c.x;return mod(s,4.)<2.;}
vec4 cloth(vec2 p){
 vec2 q=abs(p-vec2(465.,201.))-vec2(389.,185.)+156.;
 float sd=length(max(q,0.))+min(max(q.x,q.y),0.)-156.;
 float inside=clamp(.5-sd*uK,0.,1.);
 if(inside<=0.){return vec4(0.);}
 float d=length((p-uLamp)*vec2(1.,1.15)),t=clamp(d/(420.+uFlare*120.),0.,1.);
 vec3 alb=stops(t);
 vec2 u=p/uPitch,c=floor(u),f=fract(u);
 float jac=0.;
 bool wo=warpOver(c,jac);
 float ac=wo?f.x:f.y,al=wo?f.y:f.x;
 float x=(ac-.5)/.44,prof=sqrt(max(0.,1.-x*x));
 float dA=prof>.05?-x/prof:0.;
 float dL=.9*cos(3.14159*al)*prof;
 vec2 gr=wo?vec2(dA,dL):vec2(dL,dA);
 vec3 n=normalize(vec3(-gr*.5,1.));
 float tid=wo?c.x:c.y+517.;
 float slub=vn(vec2(tid*1.7,(wo?u.y:u.x)*.12));
 float tv=(h11(tid)-.5)*.12+(slub-.5)*.10-(wo?0.:uTwo);
 vec3 L=normalize(vec3(uLamp-p,uLampH)),Hv=normalize(L+vec3(0.,0.,1.));
 float diff=clamp((dot(n,L)+.35)/1.35,0.,1.);
 vec3 T=wo?vec3(0.,1.,0.):vec3(1.,0.,0.);
 float th=dot(T,Hv),spec=pow(sqrt(max(0.,1.-th*th)),uAniso);
 float I=1./(1.+pow(d/260.,2.));
 float vis=smoothstep(1.4,3.,uK*uPitch)*(1.-uCover);
 float ao=mix(1.-uDepth,1.,prof)*(.8+.4*diff);
 float shade=mix(1.,ao*(1.+tv),vis);
 float mott=((vn(p*.06)-.5)*.08+(vn(p*.25)-.5)*.05)*uMott;
 vec3 col=alb*shade*(1.+mott);
 col+=mix(uS0,vec3(1.,.88,.66),.4)*spec*uSheen*I*smoothstep(0.,1.,d/250.)*mix(.4,prof,vis)*.45;
 col*=1.+(h21(floor(p*uK))-.5)*uFuzz;
 col+=vec3(1.,.78,.45)*pow(1.-t,2.)*(.14+.35*uFlare);
 col*=1.-.72*smoothstep(160.,540.,length(p-vec2(457.,210.)));
 return vec4(col*inside,inside);}`;

/** Skia's: `xy` arrives in the table's design points, the felt canvas scales it there. */
export const CLOTH_SKSL = `${UNIFORMS}\n${CLOTH_BODY}\nhalf4 main(vec2 xy){return half4(cloth(xy));}`;

/** WebGL's, for the fallback's bake: the mockup's own `gl_FragCoord` mapping. */
export const CLOTH_GLSL = `precision highp float;\nuniform vec2 uRes;\n${UNIFORMS}\n${CLOTH_BODY}\nvoid main(){gl_FragColor=cloth(vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uK);}`;

export type ClothUniforms = Record<string, number | number[]>;

export function rgb(hex: string): number[] {
  "worklet";
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

/**
 * Every uniform but the lamp's. `k` is device pixels per design point: the weave's
 * visibility and the edge's antialiasing are both measured in it.
 */
export function clothUniforms(stops: FeltStops, k: number): ClothUniforms {
  const out: ClothUniforms = { ...TWILL, uK: k, uLampH: LAMP_HEIGHT };
  stops.forEach((s, i) => (out[`uS${i}`] = rgb(s)));
  return out;
}
