import { useEffect, useState } from "react";

import { getTheme, onThemeChange, toggleTheme, type Theme } from "../lib/theme";

/** Subscribe to the global theme (lib/theme) as reactive state. */
export function useTheme(): { theme: Theme; toggle: () => Theme } {
  const [theme, setThemeState] = useState<Theme>(getTheme);

  useEffect(() => onThemeChange(setThemeState), []);

  return { theme, toggle: toggleTheme };
}
