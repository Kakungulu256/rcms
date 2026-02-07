type Props = {
  open: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLoading?: boolean;
};

export default function ConfirmModal({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  confirmLoading,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm text-slate-400">{description}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="btn-secondary text-sm"
            disabled={confirmLoading}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn-primary text-sm"
            disabled={confirmLoading}
          >
            {confirmLoading ? "Working..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
