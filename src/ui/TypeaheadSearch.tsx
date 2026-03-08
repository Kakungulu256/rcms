import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  label: string;
  placeholder: string;
  query: string;
  suggestions: string[];
  onQueryChange: (value: string) => void;
  maxSuggestions?: number;
};

export default function TypeaheadSearch({
  label,
  placeholder,
  query,
  suggestions,
  onQueryChange,
  maxSuggestions = 8,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const filteredSuggestions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const source =
      normalizedQuery.length === 0
        ? suggestions
        : suggestions.filter((item) => item.toLowerCase().includes(normalizedQuery));
    return source.slice(0, maxSuggestions);
  }, [maxSuggestions, query, suggestions]);

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

  const applySuggestion = (value: string) => {
    onQueryChange(value);
    setOpen(false);
    setHighlightedIndex(-1);
  };

  return (
    <label className="block text-sm text-slate-300">
      {label}
      <div className="relative mt-2" ref={containerRef}>
        <input
          type="search"
          className="input-base w-full rounded-md px-3 py-2 text-sm"
          placeholder={placeholder}
          value={query}
          onFocus={() => {
            setOpen(true);
            setHighlightedIndex(-1);
          }}
          onChange={(event) => {
            onQueryChange(event.target.value);
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
                if (filteredSuggestions.length === 0) return -1;
                if (previous >= filteredSuggestions.length - 1) return 0;
                return previous + 1;
              });
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlightedIndex((previous) => {
                if (filteredSuggestions.length === 0) return -1;
                if (previous <= 0) return filteredSuggestions.length - 1;
                return previous - 1;
              });
              return;
            }
            if (event.key === "Enter" && highlightedIndex >= 0) {
              event.preventDefault();
              applySuggestion(filteredSuggestions[highlightedIndex]);
              return;
            }
            if (event.key === "Escape") {
              setOpen(false);
              setHighlightedIndex(-1);
            }
          }}
        />
        {open && filteredSuggestions.length > 0 && (
          <div
            className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-slate-900 shadow-xl"
            style={{ borderColor: "var(--border)" }}
          >
            {filteredSuggestions.map((item, index) => (
              <button
                key={`${item}-${index}`}
                type="button"
                className={[
                  "block w-full px-3 py-2 text-left text-sm",
                  highlightedIndex === index
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-200 hover:bg-slate-800/70",
                ].join(" ")}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySuggestion(item);
                }}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
    </label>
  );
}
