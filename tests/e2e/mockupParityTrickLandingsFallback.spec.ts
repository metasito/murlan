import { test } from "@playwright/test";
import { parityTests } from "./helpers/mockupParity";

test.describe("mockup parity", () => parityTests("trick-landings", "fallback"));
