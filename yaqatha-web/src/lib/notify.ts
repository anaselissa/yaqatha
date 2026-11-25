/** تنبيه الفريق على تيليجرام. اختياري: بلا TELEGRAM_BOT_TOKEN وTELEGRAM_CHAT_ID لا يفعل شيئًا.
 *  الرسالة لا تحوي اسمًا ولا رقمًا ولا أي بيانات شخصية: نوع الطلب ورابط اللوحة فقط. */
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from 'astro:env/server';

export async function notifyTeam(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(4000),
    });
  } catch (e) { console.error('[notify]', (e as Error).message); }
}
