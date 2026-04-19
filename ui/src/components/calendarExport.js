function toGoogleDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeIcsText(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function openGoogleCalendarEvent({ eventTitle, description, startTime, endTime }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: eventTitle,
    details: description,
    dates: `${toGoogleDate(startTime)}/${toGoogleDate(endTime)}`,
  });

  window.open(
    `https://calendar.google.com/calendar/render?${params.toString()}`,
    '_blank',
    'noopener,noreferrer'
  );
}

function downloadIcsEvent({ eventTitle, description, startTime, endTime }) {
  const uid = `${Date.now()}@study-recorder`;
  const content = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Study Time Recorder//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toGoogleDate(new Date())}`,
    `DTSTART:${toGoogleDate(startTime)}`,
    `DTEND:${toGoogleDate(endTime)}`,
    `SUMMARY:${escapeIcsText(eventTitle)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = `study-${Date.now()}.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function saveStudySessionToCalendar({
  calendarType,
  eventTitle,
  description,
  startTime,
  endTime,
}) {
  if (calendarType === 'google') {
    openGoogleCalendarEvent({ eventTitle, description, startTime, endTime });
    return;
  }

  downloadIcsEvent({ eventTitle, description, startTime, endTime });
}
