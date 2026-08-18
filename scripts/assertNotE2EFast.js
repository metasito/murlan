if (process.env.EXPO_PUBLIC_E2E_FAST) {
  console.error("EXPO_PUBLIC_E2E_FAST is set — this would ship a zero-delay build.");
  process.exit(1);
}
