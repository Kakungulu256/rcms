type Props = {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export default function PaginationControls({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [20, 50, 100],
}: Props) {
  const safePageSize = Math.max(1, pageSize || 1);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const currentPage = clamp(page || 1, 1, totalPages);
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * safePageSize + 1;
  const endItem = totalItems === 0 ? 0 : Math.min(currentPage * safePageSize, totalItems);

  const windowSize = 2;
  const startPage = Math.max(1, currentPage - windowSize);
  const endPage = Math.min(totalPages, currentPage + windowSize);
  const pageNumbers = Array.from(
    { length: endPage - startPage + 1 },
    (_, index) => startPage + index
  );

  const baseButtonClass =
    "rounded-md border px-3 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <div className="text-xs text-slate-400">
        Showing {startItem}-{endItem} of {totalItems}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange && (
          <label className="text-xs text-slate-400">
            Per page
            <select
              className="input-base ml-2 rounded-md px-2 py-1 text-xs"
              value={safePageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          className={`${baseButtonClass} text-slate-300`}
          style={{ borderColor: "var(--border)" }}
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Previous
        </button>

        {startPage > 1 && (
          <>
            <button
              type="button"
              className={`${baseButtonClass} text-slate-300`}
              style={{ borderColor: "var(--border)" }}
              onClick={() => onPageChange(1)}
            >
              1
            </button>
            {startPage > 2 && <span className="px-1 text-xs text-slate-500">...</span>}
          </>
        )}

        {pageNumbers.map((pageNumber) => {
          const active = pageNumber === currentPage;
          return (
            <button
              key={pageNumber}
              type="button"
              className={`${baseButtonClass} ${
                active ? "border-blue-500 bg-blue-500/20 text-blue-200" : "text-slate-300"
              }`}
              style={!active ? { borderColor: "var(--border)" } : undefined}
              onClick={() => onPageChange(pageNumber)}
            >
              {pageNumber}
            </button>
          );
        })}

        {endPage < totalPages && (
          <>
            {endPage < totalPages - 1 && <span className="px-1 text-xs text-slate-500">...</span>}
            <button
              type="button"
              className={`${baseButtonClass} text-slate-300`}
              style={{ borderColor: "var(--border)" }}
              onClick={() => onPageChange(totalPages)}
            >
              {totalPages}
            </button>
          </>
        )}

        <button
          type="button"
          className={`${baseButtonClass} text-slate-300`}
          style={{ borderColor: "var(--border)" }}
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
