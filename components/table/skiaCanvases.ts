// Every Skia canvas the web table lazy-loads, behind one dynamic import: Metro hoists a module that two
// async chunks share into `__common`, which the first load fetches, and CanvasKit's bindings with it.
export { FeltCanvas } from "./feltCanvas";
export { HandShadeCanvas } from "./handShadeCanvas";
