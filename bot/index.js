/**
 * Agent Bot — minimal Telegram bot powered by Claude Code CLI
 * Part of jarvis-architect: personal AI agent for course students
 *
 * Features: text + voice → Claude Code → response, sessions, DNA files,
 *           persistent keyboard, folder structure awareness, typing animation
 */

import { Bot, Keyboard } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import https from "node:https";
import http from "node:http";

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.BOT_TOKEN;
const AGENT_HOME = process.env.AGENT_HOME || "/home/agent";
const WORKSPACE = join(AGENT_HOME, "workspace");
const PROJECTS = join(AGENT_HOME, "projects");
const DATA_DIR = join(AGENT_HOME, ".agent");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

// Ensure directories exist
for (const dir of [DATA_DIR, join(WORKSPACE, "memory"), join(WORKSPACE, "knowledge"), PROJECTS]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─── PERSISTENT KEYBOARD ────────────────────────────────────────────────────

const mainKeyboard = new Keyboard()
  .text("📋 Статус").text("🔄 Новый диалог").row()
  .text("📁 Проекты").text("🧠 Память").row()
  .resized()
  .persistent();

// ─── SESSIONS ────────────────────────────────────────────────────────────────

function loadSessions() {
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(SESSIONS_FILE, "utf8"))));
  } catch {
    return new Map();
  }
}

function saveSessions() {
  try {
    writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2));
  } catch (e) {
    console.error("[sessions] save error:", e.message);
  }
}

const sessions = loadSessions();

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────

const ARCHITECTURE_CONTEXT = `
## Архитектура файловой системы агента

Ты работаешь на VPS-сервере. Вот структура папок:

- /home/agent/workspace/ — твоя рабочая папка (cwd). Здесь живут DNA-файлы:
  - CLAUDE.md — правила работы
  - SOUL.md — твоя личность
  - MEMORY.md — долгосрочная память (обновляй!)
  - GOALS.md — цели пользователя
  - memory/ — дневники по дням (memory/YYYY-MM-DD.md)
  - knowledge/ — база знаний (справочники, инструкции)

- /home/agent/projects/ — папка для ПРОЕКТОВ. Когда пользователь просит создать проект, сайт, бота, скрипт — создавай папку здесь: /home/agent/projects/название-проекта/

- /home/agent/.agent/ — служебная папка бота (не трогай)

ВАЖНО: новые проекты ВСЕГДА создавай в /home/agent/projects/, НЕ в workspace/. Workspace — только для DNA-файлов и памяти.
`;

function buildSystemPrompt() {
  const parts = [ARCHITECTURE_CONTEXT];

  // DNA files — read each if exists
  const dnaFiles = ["SOUL.md", "MEMORY.md", "GOALS.md", "CLAUDE.md"];
  for (const name of dnaFiles) {
    const path = join(WORKSPACE, name);
    if (existsSync(path)) {
      try {
        parts.push(`--- ${name} ---\n${readFileSync(path, "utf8")}`);
      } catch {}
    }
  }

  // Today's diary
  const today = new Date().toISOString().split("T")[0];
  const diaryPath = join(WORKSPACE, "memory", `${today}.md`);
  if (existsSync(diaryPath)) {
    try {
      parts.push(`--- Дневник ${today} ---\n${readFileSync(diaryPath, "utf8")}`);
    } catch {}
  }

  return parts.join("\n\n");
}

// ─── CLAUDE CODE CLI ─────────────────────────────────────────────────────────

// Sequential queue — only one Claude call at a time
let _queue = Promise.resolve();

function callClaude(prompt, sessionId) {
  const p = _queue.then(() => _callClaudeInner(prompt, sessionId));
  _queue = p.catch(() => {});
  return p;
}

function _callClaudeInner(prompt, sessionId) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--output-format", "json",
      "--max-turns", "15",
      "--model", "sonnet",
      "--dangerously-skip-permissions",
    ];

    const systemPrompt = buildSystemPrompt();
    if (systemPrompt) args.push("--append-system-prompt", systemPrompt);

    if (sessionId) args.push("--resume", sessionId);

    const child = spawn("claude", args, {
      cwd: WORKSPACE,
      env: { ...process.env, HOME: AGENT_HOME },
      timeout: 600000, // 10 min
    });
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        return reject(new Error(`Claude exit ${code}: ${stderr.slice(0, 300)}`));
      }
      try {
        const result = JSON.parse(stdout);
        resolve({
          text: result.result || result.text || "(пустой ответ)",
          sessionId: result.session_id || sessionId,
          cost: result.cost_usd || 0,
        });
      } catch {
        const text = stdout.trim();
        resolve({ text: text || "(пустой ответ)", sessionId, cost: 0 });
      }
    });

    child.on("error", reject);
  });
}

// ─── VOICE HANDLING ──────────────────────────────────────────────────────────

async function downloadFile(url, destPath) {
  const proto = url.startsWith("https") ? https : http;
  const response = await new Promise((resolve, reject) => {
    proto.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      resolve(res);
    }).on("error", reject);
  });
  await pipeline(response, createWriteStream(destPath));
}

async function transcribeVoice(filePath) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return null;

  return new Promise((resolve, reject) => {
    const fileData = readFileSync(filePath);
    const options = {
      hostname: "api.deepgram.com",
      path: "/v1/listen?model=nova-2&language=ru&smart_format=true",
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "audio/ogg",
        "Content-Length": fileData.length,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          resolve(result.results?.channels?.[0]?.alternatives?.[0]?.transcript || "");
        } catch {
          resolve("");
        }
      });
    });
    req.on("error", reject);
    req.write(fileData);
    req.end();
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getStatusText() {
  const dnaFiles = ["SOUL.md", "MEMORY.md", "GOALS.md", "CLAUDE.md"];
  const found = dnaFiles.filter((f) => existsSync(join(WORKSPACE, f)));
  const missing = dnaFiles.filter((f) => !existsSync(join(WORKSPACE, f)));

  let projectsList = "пусто";
  try {
    const dirs = readdirSync(PROJECTS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    if (dirs.length > 0) projectsList = dirs.join(", ");
  } catch {}

  const today = new Date().toISOString().split("T")[0];
  const hasDiary = existsSync(join(WORKSPACE, "memory", `${today}.md`));

  return (
    `📋 Статус агента\n\n` +
    `DNA-файлы: ${found.length}/4 (${found.join(", ")})\n` +
    `${missing.length > 0 ? `Не найдены: ${missing.join(", ")}\n` : ""}` +
    `Дневник сегодня: ${hasDiary ? "есть" : "нет"}\n` +
    `Проекты: ${projectsList}\n\n` +
    `Workspace: ${WORKSPACE}\n` +
    `Проекты: ${PROJECTS}`
  );
}

function getProjectsText() {
  let dirs = [];
  try {
    dirs = readdirSync(PROJECTS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {}

  if (dirs.length === 0) {
    return (
      `📁 Проекты\n\n` +
      `Папка проектов пока пустая.\n` +
      `Путь: ${PROJECTS}\n\n` +
      `Попросите меня создать проект — я создам его здесь.`
    );
  }

  return (
    `📁 Проекты (${dirs.length})\n\n` +
    dirs.map((d) => `- ${d}`).join("\n") +
    `\n\nПуть: ${PROJECTS}`
  );
}

function getMemoryText() {
  const memoryDir = join(WORKSPACE, "memory");
  let files = [];
  try {
    files = readdirSync(memoryDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, 7);
  } catch {}

  const memoryExists = existsSync(join(WORKSPACE, "MEMORY.md"));
  let memorySize = 0;
  if (memoryExists) {
    try {
      memorySize = readFileSync(join(WORKSPACE, "MEMORY.md"), "utf8").split("\n").length;
    } catch {}
  }

  return (
    `🧠 Память\n\n` +
    `MEMORY.md: ${memoryExists ? `${memorySize} строк` : "не найден"}\n\n` +
    `Последние дневники:\n` +
    (files.length > 0 ? files.map((f) => `- ${f}`).join("\n") : "пусто") +
    `\n\nПуть: ${WORKSPACE}/memory/`
  );
}

async function sendResponse(ctx, text) {
  if (text.length <= 4096) {
    await ctx.reply(text, { reply_markup: mainKeyboard });
  } else {
    const chunks = [];
    for (let i = 0; i < text.length; i += 4096) {
      chunks.push(text.slice(i, i + 4096));
    }
    for (let i = 0; i < chunks.length; i++) {
      const markup = i === chunks.length - 1 ? { reply_markup: mainKeyboard } : {};
      await ctx.reply(chunks[i], markup);
    }
  }
}

// ─── TELEGRAM BOT ────────────────────────────────────────────────────────────

const bot = new Bot(BOT_TOKEN);
bot.api.config.use(autoRetry());

// /start
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Привет! Я твой персональный AI-агент.\n\n" +
    "Пиши мне текстом или отправляй голосовые — я помогу с любыми задачами.\n\n" +
    "Используй кнопки внизу или просто пиши.",
    { reply_markup: mainKeyboard }
  );
});

// /reset
bot.command("reset", async (ctx) => {
  const userId = String(ctx.from.id);
  sessions.delete(userId);
  saveSessions();
  await ctx.reply("Сессия сброшена. Начинаем с чистого листа.", { reply_markup: mainKeyboard });
});

// /status
bot.command("status", async (ctx) => {
  await ctx.reply(getStatusText(), { reply_markup: mainKeyboard });
});

// Button handlers
bot.hears("📋 Статус", async (ctx) => {
  await ctx.reply(getStatusText(), { reply_markup: mainKeyboard });
});

bot.hears("🔄 Новый диалог", async (ctx) => {
  const userId = String(ctx.from.id);
  sessions.delete(userId);
  saveSessions();
  await ctx.reply("Сессия сброшена. Начинаем с чистого листа.", { reply_markup: mainKeyboard });
});

bot.hears("📁 Проекты", async (ctx) => {
  await ctx.reply(getProjectsText(), { reply_markup: mainKeyboard });
});

bot.hears("🧠 Память", async (ctx) => {
  await ctx.reply(getMemoryText(), { reply_markup: mainKeyboard });
});

// Handle text messages
bot.on("message:text", async (ctx) => {
  const userId = String(ctx.from.id);
  const text = ctx.message.text;

  const thinkingMsg = await ctx.reply("Думаю... ⏳");
  const typingInterval = setInterval(() => {
    ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
  }, 4000);

  try {
    const sessionId = sessions.get(userId) || null;
    const result = await callClaude(text, sessionId);

    if (result.sessionId) {
      sessions.set(userId, result.sessionId);
      saveSessions();
    }

    clearInterval(typingInterval);
    await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    await sendResponse(ctx, result.text);
  } catch (err) {
    clearInterval(typingInterval);
    await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    console.error("[error]", err.message);
    await ctx.reply("Произошла ошибка. Попробуй ещё раз или нажми 🔄 Новый диалог.", { reply_markup: mainKeyboard });
  }
});

// Handle voice messages
bot.on("message:voice", async (ctx) => {
  if (!process.env.DEEPGRAM_API_KEY) {
    return ctx.reply("Голосовые пока не поддерживаются. Нужен DEEPGRAM_API_KEY в .env", { reply_markup: mainKeyboard });
  }

  const thinkingMsg = await ctx.reply("Слушаю голосовое... 🎤");
  const typingInterval = setInterval(() => {
    ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
  }, 4000);

  try {
    const file = await ctx.getFile();
    const tmpPath = `/tmp/voice_${ctx.from.id}_${Date.now()}.ogg`;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    await downloadFile(fileUrl, tmpPath);

    const transcript = await transcribeVoice(tmpPath);
    unlinkSync(tmpPath);

    if (!transcript) {
      clearInterval(typingInterval);
      await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
      return ctx.reply("Не удалось распознать голосовое. Попробуй ещё раз.", { reply_markup: mainKeyboard });
    }

    await ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id,
      `Распознано: "${transcript.slice(0, 100)}${transcript.length > 100 ? "..." : ""}"\n\nДумаю... ⏳`);

    const userId = String(ctx.from.id);
    const sessionId = sessions.get(userId) || null;
    const result = await callClaude(transcript, sessionId);

    if (result.sessionId) {
      sessions.set(userId, result.sessionId);
      saveSessions();
    }

    clearInterval(typingInterval);
    await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    await sendResponse(ctx, result.text);
  } catch (err) {
    clearInterval(typingInterval);
    await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    console.error("[voice-error]", err.message);
    await ctx.reply("Ошибка обработки голосового. Попробуй текстом.", { reply_markup: mainKeyboard });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────

bot.catch((err) => console.error("[bot-error]", err.message));

bot.start({
  onStart: () => console.log(`Agent bot started (workspace: ${WORKSPACE}, projects: ${PROJECTS})`),
  drop_pending_updates: true,
});
