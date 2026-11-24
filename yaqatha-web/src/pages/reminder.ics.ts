import type { APIRoute } from 'astro';


// تذكير يومي في تقويم الهاتف: حدث متكرر يوميًا بوقت الجهاز المحلي (بلا منطقة زمنية)، مع تنبيه عند موعده.
// لا حساب ولا بيانات: الملف نفسه لكل من يطلبه، والوقت فقط يتغير.
export const GET: APIRoute = ({ url }) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(url.searchParams.get('t') ?? '20:00');
  const [hh, mm] = m ? [m[1], m[2]] : ['20', '00'];
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const link = `${url.origin}/journey`;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Yaqatha//Reminder//AR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:yaqatha-daily-${hh}${mm}@yaqatha`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${ymd}T${hh}${mm}00`,
    'DURATION:PT10M',
    'RRULE:FREQ=DAILY',
    'SUMMARY:يقظة: خطوتك اليوم',
    `DESCRIPTION:دقائق قليلة مع خطوتك اليومية في يقظة.\\n${link}`,
    `URL:${link}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:يقظة: خطوتك اليوم', 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="yaqatha-reminder.ics"',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
