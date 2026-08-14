import type {
  CommentLength,
  ReadingCommentMode,
  ReadingPosition
} from "@ss/shared";

type PromptSource = "catch_up_complete" | "current_only" | "quick_action";

export function normalizeCommentLength(
  mode: ReadingCommentMode,
  requestedLength: CommentLength
): CommentLength {
  if (
    requestedLength === "long" &&
    mode !== "deep_analysis" &&
    mode !== "diary_summary"
  ) {
    return "normal";
  }
  return requestedLength;
}

export function buildReadingCommentPrompt(input: {
  sessionId: string;
  mode: ReadingCommentMode;
  length: CommentLength;
  title: string;
  position: ReadingPosition;
  syncedRange?: { start: number; end: number };
  source: PromptSource;
  operationId: string;
}): string {
  const length = normalizeCommentLength(input.mode, input.length);
  const intro = [
    input.source === "catch_up_complete"
      ? `补课已确认完成。请整合刚才第 ${input.syncedRange?.start ?? input.position.index}-${input.syncedRange?.end ?? input.position.index} 页的内容，再陪用户聊当前${input.position.label}。`
      : `用户正在读《${input.title}》的${input.position.label}。`,
    lengthInstruction(input.mode, length)
  ];
  const modeInstructions = modeInstruction(input.mode);
  const publication = [
    "本次阅读器不会自动把共读回应保存到书内。",
    "不要调用任何应用写回工具；直接在聊天区回复即可。",
    "不要说共读回应已保存，也不要显示同步诊断，因为本次没有尝试写回。"
  ];
  return [...intro, ...modeInstructions, ...publication].join("\n\n");
}

export function buildLiveReadingPrompt(input: {
  sessionId: string;
  title: string;
  position: ReadingPosition;
  operationId: string;
  requestedMode?: ReadingCommentMode;
  requestedLength?: CommentLength;
}): string {
  const publication = [
    "本次阅读器不会自动把共读回应保存到书内。",
    "不要调用任何应用写回工具；直接在聊天区回复即可。"
  ];
  return [
    `【实时陪读：${input.position.label}】《${input.title}》`,
    "固定模式：reaction_only；固定长度：short；风格：danmaku。",
    "只输出 1-3 句弹幕式共读回应。",
    "不总结全文，不重复剧情，不写完整书评。",
    "只做即时反应、吐槽、嗑点或伏笔提醒。",
    ...publication
  ].join("\n\n");
}

function lengthInstruction(mode: ReadingCommentMode, length: CommentLength) {
  if (mode === "reaction_only" && length === "short") return "长度：1-5 句。";
  if (length === "short") return "长度控制在 50-150 字。";
  if (length === "long") return "长度可为 600 字以上。";
  return "长度控制在 150-400 字。";
}

function modeInstruction(mode: ReadingCommentMode): string[] {
  if (mode === "light_chat") {
    return [
      "请用轻松共读模式，只挑最有意思的 1-3 个点回应。",
      "可以轻轻回应、吐槽、嗑点或简单猜一点伏笔。",
      "不需要完整书评，不需要逐项总结。",
      "只有用户明确要求认真分析、深度分析、写长评或详细说时，才展开完整分析。"
    ];
  }
  if (mode === "reaction_only") {
    return [
      "像弹幕一样做即时反应，控制在 1-5 句。",
      "不总结剧情，不分析结构。"
    ];
  }
  if (mode === "cp_talk") {
    return [
      "聚焦人物关系张力、暧昧、占有欲、互动反差和好嗑之处。",
      "少复述剧情，不展开完整人物报告。"
    ];
  }
  if (mode === "plot_guess") {
    return [
      "聚焦伏笔、隐藏信息和后续走向。",
      "明确区分原文事实和猜测，不详细总结已经发生的剧情。"
    ];
  }
  if (mode === "deep_analysis") {
    return [
      "这是用户主动选择的深度分析。",
      "按完整结构讨论：剧情变化、人物变化、伏笔猜测、当前感受。"
    ];
  }
  return [
    "这是读书日记总结，不是普通段落点评。",
    "整理今天的阅读进度、摘录、吐槽和余味，写成可复制的日记。"
  ];
}
