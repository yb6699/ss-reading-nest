import { Bookmark, Check, Copy, LoaderCircle, Sparkles } from "lucide-react";

export function ReaderActions(props: {
  primaryLabel: string;
  pageLabel: string;
  onPrimary: () => void;
  onCopy: () => void;
  copyState?: "idle" | "copied" | "error";
  onPage: () => void;
  onFinish: () => void;
  primaryDisabled?: boolean;
}) {
  return (
    <nav className="reader-actions" aria-label="共读操作">
      <button
        type="button"
        className="action-primary reader-primary-action"
        onClick={props.onPrimary}
        disabled={props.primaryDisabled}
        aria-busy={props.primaryDisabled || undefined}
      >
        {props.primaryDisabled ? (
          <LoaderCircle className="reader-action-icon reader-action-spinner" aria-hidden="true" strokeWidth={1.8} />
        ) : (
          <Sparkles className="reader-action-icon" aria-hidden="true" strokeWidth={1.8} />
        )}
        <span>{props.primaryDisabled ? "正在共读…" : props.primaryLabel}</span>
      </button>
      <button
        type="button"
        className="reader-finish-action"
        onClick={props.onCopy}
        aria-label="复制当前页给G老师"
      >
        {props.copyState === "copied" ? (
          <Check className="reader-action-icon" aria-hidden="true" strokeWidth={1.8} />
        ) : (
          <Copy className="reader-action-icon" aria-hidden="true" strokeWidth={1.8} />
        )}
        <span>
          {props.copyState === "copied"
            ? "已复制"
            : props.copyState === "error"
              ? "复制失败"
              : "复制给G老师"}
        </span>
      </button>
      <button
        type="button"
        className="reader-page-status"
        aria-label={`阅读进度 ${props.pageLabel}，打开目录与跳页`}
        onClick={props.onPage}
      >
        <span>页码</span>
        <strong>{props.pageLabel}</strong>
      </button>
      <button type="button" className="reader-finish-action" onClick={props.onFinish}>
        <Bookmark className="reader-action-icon" aria-hidden="true" strokeWidth={1.8} />
        <span>留在此页</span>
      </button>
    </nav>
  );
}
