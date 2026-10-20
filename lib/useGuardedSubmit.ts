import { useRef, useState, type RefObject } from "react";
import type { TextInput, TextInputProps } from "react-native";

type FieldProps = Pick<TextInputProps, "editable" | "onSubmitEditing">;

/**
 * Both halves of the in-flight guard for a field that submits on return: `editable` is what
 * iOS and Android honour, and on web it becomes `readOnly`, which react-native-web's Enter
 * handler ignores, so `submit` itself refuses re-entry from a ref, synchronously.
 * An error thrown by `run` reaches `submit`'s caller after `busy` clears.
 */
export function useGuardedSubmit(run: () => Promise<void>): {
  busy: boolean;
  submit: () => Promise<void>;
  field: FieldProps;
} {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await run();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return { busy, submit, field: { editable: !busy, onSubmitEditing: () => void submit() } };
}

/** For a field whose return key only moves focus to the next one. */
export function useReturnFocuses(
  next: RefObject<TextInput | null>,
): Pick<TextInputProps, "onSubmitEditing" | "returnKeyType" | "submitBehavior"> {
  return { onSubmitEditing: () => next.current?.focus(), returnKeyType: "next", submitBehavior: "submit" };
}
