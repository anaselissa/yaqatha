import { defineConfig, envField, sessionDrivers } from 'astro/config';
import node from '@astrojs/node';

// المحوّل: node للتطوير والاختبار، cloudflare للإنتاج (ASTRO_ADAPTER=cloudflare).
const adapter =
  process.env.ASTRO_ADAPTER === 'cloudflare'
    ? (await import('@astrojs/cloudflare')).default({ imageService: 'passthrough' })
    : node({ mode: 'standalone' });

// في الإنتاج يجب ضبط SITE_URL، وإلا ستخرج الروابط القانونية وsitemap بعنوان localhost
if ((process.env.CF_PAGES || process.env.ASTRO_ADAPTER === 'cloudflare') && !process.env.SITE_URL) {
  throw new Error('SITE_URL غير مضبوط: اضبطه (مثل https://yaqatha.example) قبل بناء الإنتاج');
}

export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  output: 'server',
  adapter,
  trailingSlash: 'never',
  build: { inlineStylesheets: 'auto' },
  // لا نستخدم جلسات Astro (الجلسة كوكيز Supabase)؛ برنامج تشغيل غير KV يمنع المحوّل من طلب مورد KV
  session: { driver: sessionDrivers.memory() },
  security: { checkOrigin: true },
  devToolbar: { enabled: false },
  // أسرار اختيارية (تُضبط في Cloudflare ← Settings ← Variables and Secrets). بدونها تعمل الميزة المرتبطة كأن لم تكن.
  env: {
    schema: {
      // تنبيه الفريق على تيليجرام عند طلب متابعة جديد (بلا أي بيانات شخصية في الرسالة)
      TELEGRAM_BOT_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      TELEGRAM_CHAT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});
