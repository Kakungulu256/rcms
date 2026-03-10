import { useEffect, useMemo, useRef, useState } from "react";

export type TypeaheadOption = {
  id: string;
  label: string;
  description?: string;
  keywords?: string;
};

type Props = {
  label: string;
  placeholder: string;
  selectedIds: string[];
  options: TypeaheadOption[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  emptyStateText?: string;
  maxResults?: number;
  helperText?: string;
};

export default function TypeaheadMultiSelect({
  label,
  placeholder,
  selectedIds,
  options,
  onChange,
  disabled,
  emptyStateText = "No matches found.",
  maxResults = 8,
  helperText,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const selectedOptions = useMemo(() => {
    const lookup = new Map(options.map((option) => [option.id, option]));
    return selectedIds.map((id) => lookup.get(id)).filter(Boolean) as TypeaheadOption[];
  }, [options, selectedIds]);

  const filteredOptions = useMemo(() => {
    const query = inputValue.trim().toLowerCase();
    const source =
      query.length === 0
        ? options
        : options.filter((option) => {
            const haystack = [
              option.label,
              option.description ?? "",
              option.keywords ?? "",
            ]
              .join(" ")
              .toLowerCase();
            return haystack.includes(query);
          });
    return source
      .filter((option) => !selectedIds.includes(option.id))
      .slice(0, maxResults);
  }, [inputValue, maxResults, options, selectedIds]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setHighlightedIndex(-1);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const addOption = (option: TypeaheadOption) => {
    if (selectedIds.includes(option.id)) return;
    onChange([...selectedIds, option.id]);
    setInputValue("");
    setOpen(true);
    setHighlightedIndex(-1);
  };

  const removeOption = (id: string) => {
    onChange(selectedIds.filter((value) => value !== id));
  };

  return (
    <label className="block text-sm text-slate-300">
      {label}
      <div className="relative mt-2 space-y-2" ref={containerRef}>
        {selectedOptions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedOptions.map((option) => (
              <span
                key={option.id}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300/50 bg-slate-900/40 px-3 py-1 text-xs text-slate-200"
              >
                <span>{option.label}</span>
                <button
                  type="button"
                  onClick={() => removeOption(option.id)}
                  className="text-slate-400 hover:text-slate-200"
                  aria-label={`Remove ${option.label}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          type="text"
          className="input-base w-full rounded-md px-3 py-2 text-sm"
          placeholder={placeholder}
          value={inputValue}
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setHighlightedIndex(-1);
          }}
          onChange={(event) => {
            setInputValue(event.target.value);
            setOpen(true);
            setHighlightedIndex(-1);
          }}
          onKeyDown={(event) => {
            if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              setOpen(true);
              return;
            }
            if (!open) return;

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlightedIndex((previous) => {
                if (filteredOptions.length === 0) return -1;
                if (previous >= filteredOptions.length - 1) return 0;
                return previous + 1;
              });
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlightedIndex((previous) => {
                if (filteredOptions.length === 0) return -1;
                if (previous <= 0) return filteredOptions.length - 1;
                return previous - 1;
              });
              return;
            }
            if (event.key === "Enter") {
              if (highlightedIndex < 0 || highlightedIndex >= filteredOptions.length) return;
              event.preventDefault();
              addOption(filteredOptions[highlightedIndex]);
              return;
            }
            if (event.key === "Escape") {
              setOpen(false);
              setHighlightedIndex(-1);
            }
            if (event.key === "Backspace" && inputValue.trim().length === 0) {
              const last = selectedIds[selectedIds.length - 1];
              if (last) {
                removeOption(last);
              }
            }
          }}
        />
        {helperText ? <div className="text-xs text-slate-500">{helperText}</div> : null}
        {open && (
          <div
            className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-slate-900 shadow-xl"
            style={{ borderColor: "var(--border)" }}
          >
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500">{emptyStateText}</div>
            ) : (
              filteredOptions.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  className={[
                    "block w-full px-3 py-2 text-left",
                    highlightedIndex === index
                      ? "bg-slate-800 text-slate-100"
                      : "text-slate-200 hover:bg-slate-800/70",
                  ].join(" ")}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    addOption(option);
                  }}
                >
                  <div className="text-sm">{option.label}</div>
                  {option.description && (
                    <div className="text-xs text-slate-400">{option.description}</div>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </label>
  );
}
