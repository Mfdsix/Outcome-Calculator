import "@testing-library/jest-dom/vitest";

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

const store = new Map<string, string>();

const createStorage = () => ({
  getItem(key: string): string | null {
    return store.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    store.set(key, value);
  },
  removeItem(key: string): void {
    store.delete(key);
  },
  clear(): void {
    store.clear();
  },
  key(index: number): string | null {
    return Array.from(store.keys())[index] ?? null;
  },
  get length(): number {
    return store.size;
  },
});

Object.defineProperties(globalThis, {
  localStorage: {
    value: createStorage(),
    configurable: true,
    writable: false,
  },
  sessionStorage: {
    value: createStorage(),
    configurable: true,
    writable: false,
  },
});

afterEach(() => {
  cleanup();
  store.clear();
});