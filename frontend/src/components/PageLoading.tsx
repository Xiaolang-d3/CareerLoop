import { LoaderCircle } from "lucide-react";

export function PageLoading({ label }: { label: string }) {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <div className="page-loading-copy">
        <LoaderCircle className="spinning" size={18} />
        <span>{label}</span>
      </div>
      <div className="page-loading-skeleton" aria-hidden="true">
        <i /><i /><i />
      </div>
    </div>
  );
}
