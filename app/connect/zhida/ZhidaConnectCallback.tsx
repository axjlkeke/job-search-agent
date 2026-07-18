"use client";

import { useEffect, useState } from "react";
import styles from "./zhida-connect.module.css";

type State = "connecting" | "success" | "error";

function safeReturnTo(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/v2?view=profile";
}

export function ZhidaConnectCallback() {
  const [state, setState] = useState<State>("connecting");
  const [message, setMessage] = useState("正在核对一次性授权，请稍候…");

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const code = parameters.get("code");
    const authorizationState = parameters.get("state");
    const authorizationError = parameters.get("error");
    if (authorizationError || !code || !authorizationState) {
      const timer = window.setTimeout(() => {
        setState("error");
        setMessage("授权没有完成。你可以返回档案页重新连接，或继续手工建档。");
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    void fetch("/api/zhida-connect/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state: authorizationState }),
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          connected?: boolean;
          returnTo?: unknown;
          error?: string;
        };
        if (!response.ok || !result.connected) {
          throw new Error(result.error || "主站资料接力没有完成。");
        }
        setState("success");
        setMessage("资料接力完成，正在返回档案页供你核对…");
        window.setTimeout(() => {
          window.location.replace(safeReturnTo(result.returnTo));
        }, 450);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState("error");
        setMessage(error instanceof Error ? error.message : "主站资料接力没有完成。");
      });
    return () => controller.abort();
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-live="polite">
        <div className={`${styles.mark} ${styles[state]}`} aria-hidden="true">
          <span />
        </div>
        <p className={styles.eyebrow}>职达主站 · 求职Agent</p>
        <h1>{state === "error" ? "连接未完成" : "正在安全接力资料"}</h1>
        <p className={styles.message}>{message}</p>
        <div className={styles.rule} />
        <p className={styles.note}>
          仅接收学历、求职偏好和可用功能；姓名、手机号、证件和简历原文件不会导入。
        </p>
        {state === "error" ? (
          <a className={styles.action} href="/v2?view=profile">
            返回档案页
          </a>
        ) : null}
      </section>
    </main>
  );
}
