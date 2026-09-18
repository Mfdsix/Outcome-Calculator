import { useCallback, useState } from "react";

import { digitsToAmount, normalizeDigits } from "../lib/currency";

export interface UseCalculatorResult {
  input: string;
  amount: number;
  display: string;
  isEditing: boolean;
  editingId: string | null;
  pressDigit: (digit: string) => void;
  pressBackspace: () => void;
  startEdit: (id: string, amount: number) => void;
  clear: () => void;
  setEditingId: (id: string | null) => void;
}

/** Digit entry state machine (spec §6): append, strip leading zeros, backspace. */
export function useCalculator(): UseCalculatorResult {
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const pressDigit = useCallback((digit: string) => {
    setInput((current) => normalizeDigits(current + digit).slice(0, 13));
  }, []);

  const pressBackspace = useCallback(() => {
    setInput((current) => current.slice(0, -1));
  }, []);

  const startEdit = useCallback((id: string, amount: number) => {
    setEditingId(id);
    setInput(String(amount));
  }, []);

  const clear = useCallback(() => {
    setInput("");
    setEditingId(null);
  }, []);

  return {
    input,
    amount: digitsToAmount(input),
    display: input ? formatDisplay(input) : "0",
    isEditing: editingId !== null,
    editingId,
    pressDigit,
    pressBackspace,
    startEdit,
    clear,
    setEditingId,
  };
}

function formatDisplay(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
