// jest-expo's native environment, warning, as a CI annotation, about a test or hook that finished over
// its share of its own timeout (tests/helpers/timeoutHeadroom.mjs). It never fails the test.
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { headroomMessage, overHeadroom } from "../../helpers/timeoutHeadroom.mjs";

const NativeEnvironment = createRequire(import.meta.url)("jest-expo/src/preset/nativeEnvironment.js");

/** @param {string} message */
const warn = (message) => void process.stderr.write(`::warning::timeout headroom: ${message}\n`);

/** @param {{ name: string, parent?: unknown }} block */
const fullName = (block) => {
  const names = [];
  for (let at = block; at?.parent; at = at.parent) names.unshift(at.name);
  return names.join(" › ") || "the file";
};

export default class TimeoutHeadroomEnvironment extends NativeEnvironment {
  /** @type {Map<object, number>} */
  started = new Map();

  /** @param {any} event @param {any} state */
  async handleTestEvent(event, state) {
    await super.handleTestEvent?.(event, state);
    switch (event.name) {
      case "test_fn_start":
        this.started.set(event.test, performance.now());
        break;
      case "hook_start":
        this.started.set(event.hook, performance.now());
        break;
      case "test_fn_success": {
        const spent = performance.now() - (this.started.get(event.test) ?? Infinity);
        const limit = event.test.timeout || state.testTimeout;
        if (overHeadroom(spent, limit)) warn(`"${fullName(event.test)}": ${headroomMessage("This test", spent, limit)}`);
        break;
      }
      case "hook_success": {
        const spent = performance.now() - (this.started.get(event.hook) ?? Infinity);
        const limit = event.hook.timeout || state.testTimeout;
        if (!overHeadroom(spent, limit)) break;
        if (event.test) warn(`"${fullName(event.test)}": ${headroomMessage(`Its ${event.hook.type} hook`, spent, limit)}`);
        else warn(headroomMessage(`The ${event.hook.type} hook of "${fullName(event.describeBlock)}"`, spent, limit));
        break;
      }
    }
  }
}
