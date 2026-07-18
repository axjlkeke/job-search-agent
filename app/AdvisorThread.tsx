"use client";

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import {
  ArrowDown,
  ArrowSquareOut,
  CircleNotch,
  Info,
  PaperPlaneTilt,
  Sparkle,
  UserCircle,
} from "@phosphor-icons/react";

export type Citation = {
  id: string;
  title: string;
  snippet: string;
  url: string | null;
  publishedAt: string | null;
};

export type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: Citation[];
  createdAt?: Date | string;
};

export type AdvisorThreadStyles = Readonly<
  Record<string, string | undefined>
>;

export type AdvisorThreadProps = {
  messages: readonly Message[];
  isRunning: boolean;
  disabled: boolean;
  placeholder: string;
  suggestions: readonly string[];
  onSend: (text: string) => Promise<void> | void;
  styles: AdvisorThreadStyles;
  className?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  ariaLabel?: string;
};

type VisualRole = Message["role"];

type AdvisorMessageMetadata = {
  originalRole?: VisualRole;
  citations?: Citation[];
};

function joinClasses(
  ...classNames: Array<string | undefined | null | false>
) {
  return classNames.filter(Boolean).join(" ");
}

function toCreatedAt(value: Message["createdAt"]) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function convertMessage(message: Message): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role === "system" ? "assistant" : message.role,
    content: [{ type: "text", text: message.content }],
    createdAt: toCreatedAt(message.createdAt),
    metadata: {
      custom: {
        originalRole: message.role,
        citations: message.citations ?? [],
      } satisfies AdvisorMessageMetadata,
    },
  };
}

function readText(message: AppendMessage) {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
}

function isSafeExternalUrl(value: string | null): value is string {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatPublishedAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function MessageText({ styles }: { styles: AdvisorThreadStyles }) {
  return (
    <p className={styles.advisorMessageText}>
      <MessagePartPrimitive.Text />
    </p>
  );
}

function RoleIcon({ role }: { role: VisualRole }) {
  if (role === "user") return <UserCircle aria-hidden="true" size={18} />;
  if (role === "system") return <Info aria-hidden="true" size={18} />;
  return <Sparkle aria-hidden="true" size={18} />;
}

function CitationCard({
  citation,
  styles,
}: {
  citation: Citation;
  styles: AdvisorThreadStyles;
}) {
  const publishedAt = formatPublishedAt(citation.publishedAt);
  const safeUrl = isSafeExternalUrl(citation.url) ? citation.url : undefined;

  const content = (
    <>
      <span className={styles.advisorCitationHeader}>
        <span className={styles.advisorCitationTitle}>{citation.title}</span>
        {safeUrl && (
          <ArrowSquareOut
            aria-hidden="true"
            className={styles.advisorCitationExternal}
            size={15}
          />
        )}
      </span>
      {citation.snippet && (
        <span className={styles.advisorCitationSnippet}>
          {citation.snippet}
        </span>
      )}
      {publishedAt && (
        <span className={styles.advisorCitationMeta}>{publishedAt}</span>
      )}
    </>
  );

  if (safeUrl) {
    return (
      <a
        className={styles.advisorCitation}
        href={safeUrl}
        rel="noreferrer noopener"
        target="_blank"
      >
        {content}
      </a>
    );
  }

  return <div className={styles.advisorCitation}>{content}</div>;
}

function AdvisorMessageView({ styles }: { styles: AdvisorThreadStyles }) {
  const runtimeRole = useAuiState((state) => state.message.role);
  const custom = useAuiState(
    (state) => state.message.metadata.custom,
  ) as AdvisorMessageMetadata;
  const role: VisualRole =
    custom.originalRole === "system"
      ? "system"
      : runtimeRole === "user"
        ? "user"
        : "assistant";
  const citations = role === "assistant" ? (custom.citations ?? []) : [];

  return (
    <MessagePrimitive.Root
      className={joinClasses(
        styles.advisorMessage,
        role === "user" && styles.advisorMessageUser,
        role === "assistant" && styles.advisorMessageAssistant,
        role === "system" && styles.advisorMessageSystem,
      )}
      data-role={role}
    >
      <span className={styles.advisorMessageAvatar} data-role={role}>
        <RoleIcon role={role} />
      </span>
      <div className={styles.advisorMessageBody}>
        <MessagePrimitive.Parts
          components={{ Text: () => <MessageText styles={styles} /> }}
        />
        {citations.length > 0 && (
          <div className={styles.advisorCitations} aria-label="回答依据">
            {citations.map((citation) => (
              <CitationCard
                citation={citation}
                key={citation.id}
                styles={styles}
              />
            ))}
          </div>
        )}
      </div>
    </MessagePrimitive.Root>
  );
}

function AdvisorSuggestion({ styles }: { styles: AdvisorThreadStyles }) {
  const prompt = useAuiState((state) => state.suggestion.prompt);

  return (
    <SuggestionPrimitive.Trigger
      className={styles.advisorSuggestion}
      send
      type="button"
    >
      {prompt}
    </SuggestionPrimitive.Trigger>
  );
}

function AdvisorComposer({
  disabled,
  placeholder,
  styles,
}: {
  disabled: boolean;
  placeholder: string;
  styles: AdvisorThreadStyles;
}) {
  return (
    <ComposerPrimitive.Root className={styles.advisorComposer}>
      <ComposerPrimitive.Input
        aria-label="输入给求职顾问的问题"
        className={styles.advisorComposerInput}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        submitMode="enter"
      />
      <div className={styles.advisorComposerAction}>
        <ComposerPrimitive.Send
          aria-label="发送消息"
          className={styles.advisorSendButton}
          type="button"
        >
          <PaperPlaneTilt aria-hidden="true" size={18} weight="fill" />
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}

export function AdvisorThread({
  messages,
  isRunning,
  disabled,
  placeholder,
  suggestions,
  onSend,
  styles,
  className,
  emptyTitle = "从当前目标开始规划",
  emptyDescription =
    "顾问会结合学生档案、已选岗位和知识库给出下一步建议。",
  ariaLabel = "AI 求职顾问对话",
}: AdvisorThreadProps) {
  const runtime = useExternalStoreRuntime<Message>({
    messages,
    isRunning,
    isDisabled: disabled,
    isSendDisabled: disabled || isRunning,
    suggestions: suggestions.map((prompt) => ({ prompt })),
    convertMessage,
    onNew: async (message) => {
      const text = readText(message);
      if (!text || disabled || isRunning) return;
      await onSend(text);
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root
        aria-label={ariaLabel}
        className={joinClasses(styles.advisorThread, className)}
      >
        <ThreadPrimitive.Viewport className={styles.advisorViewport}>
          <div className={styles.advisorThreadContent}>
            {messages.length === 0 && (
              <div className={styles.advisorEmpty}>
                <h3 className={styles.advisorEmptyTitle}>{emptyTitle}</h3>
                <p className={styles.advisorEmptyDescription}>
                  {emptyDescription}
                </p>
              </div>
            )}

            <div className={styles.advisorMessages}>
              <ThreadPrimitive.Messages>
                {() => <AdvisorMessageView styles={styles} />}
              </ThreadPrimitive.Messages>
              {isRunning && (
                <div
                  aria-live="polite"
                  className={styles.advisorRunning}
                  role="status"
                >
                  <CircleNotch
                    aria-hidden="true"
                    className={styles.advisorRunningIcon}
                    size={17}
                  />
                  <span>正在检索知识库并生成建议…</span>
                </div>
              )}
            </div>

            <ThreadPrimitive.ViewportFooter
              className={styles.advisorFooter}
            >
              <ThreadPrimitive.ScrollToBottom
                aria-label="回到最新消息"
                className={styles.advisorScrollButton}
              >
                <ArrowDown aria-hidden="true" size={17} />
              </ThreadPrimitive.ScrollToBottom>

              {messages.length === 0 && suggestions.length > 0 && (
                <div className={styles.advisorSuggestions}>
                  <ThreadPrimitive.Suggestions>
                    {() => <AdvisorSuggestion styles={styles} />}
                  </ThreadPrimitive.Suggestions>
                </div>
              )}

              <AdvisorComposer
                disabled={disabled || isRunning}
                placeholder={placeholder}
                styles={styles}
              />
            </ThreadPrimitive.ViewportFooter>
          </div>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
