import { useCallback, useState } from "react";

import type { AllocationType } from "@expense-app/shared";

import { digitsToAmount, normalizeDigits } from "../lib/currency";

export interface UseCalculatorResult {
  input: string;
  amount: number;
  display: string;
  isEditing: boolean;
  editingId: string | null;
  /** Current allocation type for the in-progress edit (spec §3). */
  allocationType: AllocationType;
  pressDigit: (digit: string) => void;
  pressBackspace: () => void;
  startEdit: (id: string, amount: number, allocationType?: AllocationType) => void;
  clear: () => void;
  setEditingId: (id: string | null) => void;
  setAllocationType: (type: AllocationType) => void;
  toggleAllocationType: () => void;
}

/** Digit entry state machine (spec §6): append, strip leading zeros, backspace. */
export function useCalculator(): UseCalculatorResult {
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [allocationType, setAllocationTypeState] = useState<AllocationType>("NONE");

  const pressDigit = useCallback((digit: string) => {
    setInput((current) => normalizeDigits(current + digit).slice(0, 13));
  }, []);

  const pressBackspace = useCallback(() => {
    setInput((current) => current.slice(0, -1));
  }, []);

  const startEdit = useCallback((id: string, amount: number, initialType?: AllocationType) => {
    setEditingId(id);
    setInput(String(amount));
    setAllocationTypeState(initialType ?? "NONE");
  }, []);

  const clear = useCallback(() => {
    setInput("");
    setEditingId(null);
    setAllocationTypeState("NONE");
  }, []);

  const setAllocationType = useCallback((type: AllocationType) => {
    setAllocationTypeState(type);
  }, []);

  const toggleAllocationType = useCallback(() => {
    setAllocationTypeState((current) => (current === "NONE" ? "WEEKLY" : "NONE"));
  }, []);

  return {
    input,
    amount: digitsToAmount(input),
    display: input ? formatDisplay(input) : "0",
    isEditing: editingId !== null,
    editingId,
    allocationType,
    pressDigit,
    pressBackspace,
    startEdit,
    clear,
    setEditingId,
    setAllocationType,
    toggleAllocationType,
  };
}

function formatDisplay(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
