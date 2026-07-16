import type { LayoutPrimitive } from "./api/types";

export type LayoutFontFamily = NonNullable<LayoutPrimitive["fontFamily"]>;

const layoutFontStacks: Record<LayoutFontFamily, string> = {
  Inter: '"Inter", ui-sans-serif, system-ui, sans-serif',
  Roboto: '"Roboto", ui-sans-serif, system-ui, sans-serif',
  "Source Sans 3": '"Source Sans 3", ui-sans-serif, system-ui, sans-serif',
  "Noto Sans": '"Noto Sans", ui-sans-serif, system-ui, sans-serif',
};

export function layoutFontStack(fontFamily?: string): string {
  return (
    layoutFontStacks[fontFamily as LayoutFontFamily] ?? layoutFontStacks.Inter
  );
}
