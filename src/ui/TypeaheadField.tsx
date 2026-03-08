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
  value: string;
  options: TypeaheadOption[];
  onChange: (id: string) => void;
  disabled?: boolean;
  emptyStateText?: string;
  maxResults?: number;
};

export default function TypeaheadField({
  label,
  placeholder,
  value,
  options,
  onChange,
  disabled,
  emptyStateText = "No matches found.",
  maxResults = 8,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isTyping, setIsTyping] = useState(false);

  const selectedOption = useMemo(
    () => options.find((option) => option.id === value) ?? null,
    [options, value]
  );

  useEffect(() => {
    if (isTyping) return;
    setInputValue(selectedOption?.label ?? "");
  }, [isTyping, selectedOption]);

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
    return source.slice(0, maxResults);
  }, [inputValue, maxResults, options]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setHighlightedIndex(-1);
        setIsTyping(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const selectOption = (option: TypeaheadOption) => {
    onChange(option.id);
    setInputValue(option.label);
    setIsTyping(false);
    setOpen(false);
    setHighlightedIndex(-1);
  };

  return (
    <label className="block text-sm text-slate-300">
      {label}
      <div className="relative mt-2" ref={containerRef}>
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
            const nextValue = event.target.value;
            setInputValue(nextValue);
            setIsTyping(true);
            setOpen(true);
            setHighlightedIndex(-1);
            onChange("");
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
              selectOption(filteredOptions[highlightedIndex]);
              return;
            }
            if (event.key === "Escape") {
              setOpen(false);
              setHighlightedIndex(-1);
            }
          }}
        />
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
                    selectOption(option);
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
