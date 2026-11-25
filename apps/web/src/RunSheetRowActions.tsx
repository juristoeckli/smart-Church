import { useRef, useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus } from "lucide-react";
import type { ServicePlanItem } from "@smart-church/contracts";
import { insertRunSheetItem, moveRunSheetItem, type RowSide } from "./run-sheet-order";

export function useRunSheetOrdering(items: ServicePlanItem[], commit: (items: ServicePlanItem[]) => void) {
  const active = useRef<{ items: ServicePlanItem[]; index: number } | null>(null);
  const [highlight, setHighlight] = useState<{ items: ServicePlanItem[]; index: number; side: RowSide } | null>(null);
  const clear = () => { active.current = null; setHighlight(null); };
  function position(event: DragEvent<HTMLElement>): RowSide {
    const { top, height } = event.currentTarget.getBoundingClientRect();
    return event.clientY < top + height / 2 ? "before" : "after";
  }
  return {
    row(index: number) {
      return {
        "data-run-sheet-drop": highlight?.items === items && highlight.index === index ? highlight.side : undefined,
        onDragOver(event: DragEvent<HTMLDivElement>) {
          if (active.current?.items !== items || active.current.index === index) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const side = position(event);
          setHighlight((current) => current?.items === items && current.index === index && current.side === side ? current : { items, index, side });
        },
        onDragLeave(event: DragEvent<HTMLDivElement>) {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
          setHighlight((current) => current?.index === index ? null : current);
        },
        onDrop(event: DragEvent<HTMLDivElement>) {
          const source = active.current;
          if (!source || source.items !== items) return;
          event.preventDefault();
          commit(moveRunSheetItem(items, source.index, index, position(event)));
          clear();
        },
      };
    },
    handle(index: number) {
      return {
        draggable: items.length > 1,
        onDragStart(event: DragEvent<HTMLSpanElement>) {
          active.current = { items, index };
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-smart-church-run-sheet", String(index));
        },
        onDragEnd: clear,
      };
    },
    insert(index: number, side: RowSide) {
      commit(insertRunSheetItem(items, index, side));
    },
  };
}

export function RunSheetRowActions({ index, item, ordering }: {
  index: number; item: ServicePlanItem; ordering: ReturnType<typeof useRunSheetOrdering>;
}) {
  const name = item.title.trim() || `item ${index + 1}`;
  return <>
    <span className="run-sheet-drag-handle" title="Drag to reorder" aria-hidden="true" {...ordering.handle(index)}><GripVertical size={16} /></span>
    <button type="button" className="community-row-action" aria-label={`Insert before ${name}`} title="Insert before" onClick={() => ordering.insert(index, "before")}><Plus size={12} /><ArrowUp size={11} /></button>
    <button type="button" className="community-row-action" aria-label={`Insert after ${name}`} title="Insert after" onClick={() => ordering.insert(index, "after")}><Plus size={12} /><ArrowDown size={11} /></button>
  </>;
}
