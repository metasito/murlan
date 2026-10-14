import { test } from "./fixtures";
import { parityTests } from "./helpers/mockupParity";

test.describe("mockup parity", () => parityTests("bomb", "fallback"));
