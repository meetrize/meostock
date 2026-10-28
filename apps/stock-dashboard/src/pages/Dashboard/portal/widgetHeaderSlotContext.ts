import { createContext, useContext } from 'react';

/** WidgetChrome 标题行右侧槽，供子面板 portal 注入报价指标 */
export const WidgetHeaderSlotContext = createContext<HTMLElement | null>(null);

export function useWidgetHeaderSlot(): HTMLElement | null {
  return useContext(WidgetHeaderSlotContext);
}
