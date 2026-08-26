// ===== بات آزمون‌ساز روان‌پزشکی برای تلگرام =====
// نویسنده: ساخته‌شده برای دکتر مریم محرابی
// این فایل تمام منطق بات رو داره: منوی بانک سوالات، نمایش سوال با گزینه‌ها،
// قفل‌شدن بعد از پاسخ، نمایش توضیح، ناوبری بعدی/قبلی، رفتن به شماره، پرچم مرور، و جمع‌بندی نمره.

const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");

// ---------- تنظیمات ----------
const BOT_TOKEN = process.env.BOT_TOKEN; // توکن از BotFather - در Render به‌صورت متغیر محیطی ست می‌شه
if (!BOT_TOKEN) {
  console.error("خطا: متغیر محیطی BOT_TOKEN تنظیم نشده است.");
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "data");
const SESSIONS_FILE = path.join(__dirname, "sessions.json");
const LETTERS = ["الف", "ب", "ج", "د", "ه"]; // تا ۵ گزینه پشتیبانی می‌شود

// ---------- بارگذاری بانک‌های سوال ----------
// هر فایل .json داخل پوشه data یک "بانک سوال" جداگانه است.
// نام فایل (بدون .json) به‌عنوان عنوان بانک در منو نمایش داده می‌شود.
function loadQuestionBanks() {
  const banks = {};
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const key = path.basename(file, ".json");
    try {
      const content = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
      if (Array.isArray(content) && content.length > 0) {
        banks[key] = content;
      }
    } catch (e) {
      console.error(`خطا در خواندن ${file}:`, e.message);
    }
  }
  return banks;
}

let QUESTION_BANKS = loadQuestionBanks();

// ---------- مدیریت نشست کاربران (ساده، مبتنی بر فایل) ----------
// ساختار: { [chatId]: { bank, index, answers: {idx: selectedIndex}, flagged: [idx,...] } }
let sessions = {};
function loadSessions() {
  try {
    sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
  } catch (e) {
    sessions = {};
  }
}
function saveSessions() {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), "utf8");
}
loadSessions();

function getSession(chatId) {
  if (!sessions[chatId]) {
    sessions[chatId] = { bank: null, index: 0, answers: {}, flagged: [] };
  }
  return sessions[chatId];
}

// ---------- ساخت متن سوال ----------
function buildQuestionText(bank, index) {
  const q = QUESTION_BANKS[bank][index];
  const total = QUESTION_BANKS[bank].length;
  let text = `📋 <b>${escapeHtml(q.theme || "")}</b>\n`;
  text += `سؤال ${index + 1} از ${total}\n\n`;
  text += `${escapeHtml(q.stem)}\n`;
  return text;
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------- ساخت دکمه‌های گزینه ----------
function buildOptionsKeyboard(bank, index, chatId) {
  const q = QUESTION_BANKS[bank][index];
  const session = getSession(chatId);
  const answered = session.answers.hasOwnProperty(index);
  const rows = [];
  let row = [];
  q.options.forEach((opt, i) => {
    const letter = LETTERS[i] || String(i + 1);
    let label = `${letter}) ${truncate(opt, 28)}`;
    if (answered) {
      if (i === q.correct) label = `✅ ${label}`;
      else if (i === session.answers[index]) label = `❌ ${label}`;
    }
    row.push(Markup.button.callback(label, `ans:${index}:${i}`));
    if (row.length === 1) {
      rows.push(row);
      row = [];
    }
  });
  if (row.length) rows.push(row);

  // ردیف ناوبری
  const navRow = [];
  if (index > 0) navRow.push(Markup.button.callback("◀️ قبلی", `nav:prev`));
  if (index < QUESTION_BANKS[bank].length - 1) navRow.push(Markup.button.callback("بعدی ▶️", `nav:next`));
  rows.push(navRow);

  const flagged = session.flagged.includes(index);
  rows.push([
    Markup.button.callback(flagged ? "🚩 حذف پرچم" : "🏳️ پرچم برای مرور", `flag:${index}`),
    Markup.button.callback("🔢 رفتن به شماره", `jump`),
  ]);
  rows.push([Markup.button.callback("🏁 پایان آزمون", `finish`)]);

  return Markup.inlineKeyboard(rows);
}

function truncate(str, n) {
  if (!str) return "";
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

// ---------- نمایش سوال ----------
async function showQuestion(ctx, chatId, editMessageId) {
  const session = getSession(chatId);
  const bank = session.bank;
  const index = session.index;
  const text = buildQuestionText(bank, index);
  const keyboard = buildOptionsKeyboard(bank, index, chatId);

  if (editMessageId) {
    try {
      await ctx.telegram.editMessageText(chatId, editMessageId, undefined, text, {
        parse_mode: "HTML",
        ...keyboard,
      });
      return;
    } catch (e) {
      // اگر edit ممکن نبود، پیام جدید بفرست
    }
  }
  await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
}

// ---------- منوی انتخاب بانک سوال ----------
function buildBankMenu() {
  const keys = Object.keys(QUESTION_BANKS);
  if (keys.length === 0) {
    return { text: "هنوز بانک سوالی اضافه نشده است.", keyboard: Markup.inlineKeyboard([]) };
  }
  const rows = keys.map((k) => [
    Markup.button.callback(`${k} (${QUESTION_BANKS[k].length} سؤال)`, `bank:${k}`),
  ]);
  return {
    text: "📚 یک بانک سوال را برای شروع آزمون انتخاب کنید:",
    keyboard: Markup.inlineKeyboard(rows),
  };
}

// ================= راه‌اندازی بات =================
const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
  QUESTION_BANKS = loadQuestionBanks(); // رفرش لیست بانک‌ها در هر استارت
  const { text, keyboard } = buildBankMenu();
  await ctx.reply(
    "👋 به آزمون‌ساز روان‌پزشکی خوش آمدید.\n\n" + text,
    keyboard
  );
});

bot.command("menu", async (ctx) => {
  QUESTION_BANKS = loadQuestionBanks();
  const { text, keyboard } = buildBankMenu();
  await ctx.reply(text, keyboard);
});

// انتخاب بانک سوال
bot.action(/^bank:(.+)$/, async (ctx) => {
  const bankKey = ctx.match[1];
  if (!QUESTION_BANKS[bankKey]) {
    await ctx.answerCbQuery("این بانک سوال یافت نشد.");
    return;
  }
  const chatId = ctx.chat.id;
  sessions[chatId] = { bank: bankKey, index: 0, answers: {}, flagged: [] };
  saveSessions();
  await ctx.answerCbQuery();
  await ctx.deleteMessage().catch(() => {});
  await showQuestion(ctx, chatId, null);
});

// پاسخ به سوال
bot.action(/^ans:(\d+):(\d+)$/, async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  const qIndex = parseInt(ctx.match[1], 10);
  const optIndex = parseInt(ctx.match[2], 10);

  if (qIndex !== session.index) {
    await ctx.answerCbQuery("این سوال دیگر فعال نیست.");
    return;
  }
  if (session.answers.hasOwnProperty(qIndex)) {
    await ctx.answerCbQuery("قبلاً پاسخ داده‌اید.");
    return;
  }

  session.answers[qIndex] = optIndex;
  saveSessions();

  const q = QUESTION_BANKS[session.bank][qIndex];
  const isCorrect = optIndex === q.correct;
  await ctx.answerCbQuery(isCorrect ? "✅ درست بود!" : "❌ نادرست بود.");

  // نمایش دوباره سوال با علامت درست/غلط روی دکمه‌ها
  const text = buildQuestionText(session.bank, qIndex);
  const keyboard = buildOptionsKeyboard(session.bank, qIndex, chatId);
  await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(() => {});

  // ارسال توضیح در پیام جداگانه
  let explanation = "";
  if (q.explanation) explanation += `💡 <b>توضیح:</b>\n${escapeHtml(q.explanation)}\n\n`;
  if (q.trap) explanation += `⚠️ <b>دام تستی:</b>\n${escapeHtml(q.trap)}\n\n`;
  if (q.rule) explanation += `📌 <b>قاعده کلیدی:</b>\n${escapeHtml(q.rule)}`;
  if (explanation) {
    await ctx.reply(explanation.trim(), { parse_mode: "HTML" });
  }
});

// ناوبری بعدی/قبلی
bot.action(/^nav:(next|prev)$/, async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  const dir = ctx.match[1];
  const total = QUESTION_BANKS[session.bank].length;

  if (dir === "next" && session.index < total - 1) session.index++;
  else if (dir === "prev" && session.index > 0) session.index--;
  saveSessions();

  await ctx.answerCbQuery();
  await showQuestion(ctx, chatId, ctx.callbackQuery.message.message_id);
});

// پرچم برای مرور
bot.action(/^flag:(\d+)$/, async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  const qIndex = parseInt(ctx.match[1], 10);

  const pos = session.flagged.indexOf(qIndex);
  if (pos === -1) session.flagged.push(qIndex);
  else session.flagged.splice(pos, 1);
  saveSessions();

  await ctx.answerCbQuery(pos === -1 ? "🚩 پرچم‌گذاری شد" : "پرچم برداشته شد");
  const text = buildQuestionText(session.bank, qIndex);
  const keyboard = buildOptionsKeyboard(session.bank, qIndex, chatId);
  await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(() => {});
});

// رفتن به شماره سوال خاص
bot.action("jump", async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  session.awaitingJump = true;
  saveSessions();
  await ctx.answerCbQuery();
  await ctx.reply(
    `عدد سؤال مورد نظر را بفرستید (بین ۱ تا ${QUESTION_BANKS[session.bank].length}):`
  );
});

// پایان آزمون - نمایش خلاصه نمره
bot.action("finish", async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  const questions = QUESTION_BANKS[session.bank];
  const total = questions.length;
  const answeredCount = Object.keys(session.answers).length;
  let correctCount = 0;
  Object.entries(session.answers).forEach(([idx, opt]) => {
    if (questions[idx].correct === opt) correctCount++;
  });

  let text = `🏁 <b>خلاصه آزمون</b>\n\n`;
  text += `تعداد کل سؤالات: ${total}\n`;
  text += `پاسخ داده‌شده: ${answeredCount}\n`;
  text += `پاسخ صحیح: ${correctCount}\n`;
  if (answeredCount > 0) {
    const pct = ((correctCount / answeredCount) * 100).toFixed(1);
    text += `درصد موفقیت: ${pct}%\n`;
  }
  if (session.flagged.length > 0) {
    text += `\n🚩 سؤالات پرچم‌گذاری‌شده برای مرور: ${session.flagged.map((i) => i + 1).join("، ")}`;
  }

  await ctx.answerCbQuery();
  await ctx.reply(text, { parse_mode: "HTML" });

  const { text: menuText, keyboard } = buildBankMenu();
  await ctx.reply(menuText, keyboard);
});

// دریافت شماره سوال برای jump
bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  if (!session.awaitingJump) return;

  const num = parseInt(ctx.message.text.trim(), 10);
  const total = session.bank ? QUESTION_BANKS[session.bank].length : 0;
  if (isNaN(num) || num < 1 || num > total) {
    await ctx.reply(`لطفاً عددی بین ۱ تا ${total} بفرستید.`);
    return;
  }
  session.index = num - 1;
  session.awaitingJump = false;
  saveSessions();
  await showQuestion(ctx, chatId, null);
});

bot.launch().then(() => {
  console.log("بات با موفقیت روشن شد.");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
