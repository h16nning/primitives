// One mail through the tenant's SMTP relay, with curl (Scaleway TEM over
// SMTP: the project id is the user, the key the password, the narrowest scope
// a TEM key can have). The credentials go to curl as a config on stdin; the
// message is written to a file of the run's own first.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@plexus-ms/lib';
import { run, write } from '@plexus-ms/lib';

export interface Smtp {
  host: string;
  port: string;
  user: string;
  password: string;
  from: string;
  to: string;
}

/** The relay from the environment, or undefined while any part is missing (the callers then only log). */
export function smtpFromEnv(env: NodeJS.ProcessEnv = process.env): Smtp | undefined {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM, MAIL_TO } = env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !MAIL_FROM || !MAIL_TO) return undefined;
  return {
    host: SMTP_HOST,
    port: SMTP_PORT || '587',
    user: SMTP_USER,
    password: SMTP_PASSWORD,
    from: MAIL_FROM,
    to: MAIL_TO,
  };
}

export function message(smtp: Smtp, subject: string, text: string, date: Date): string {
  const body = text.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
  return `From: plexus-ci <${smtp.from}>\r\nTo: ${smtp.to}\r\nSubject: ${subject}\r\nDate: ${date.toUTCString()}\r\n\r\n${body}\r\n`;
}

export async function sendMail(
  ctx: Context,
  smtp: Smtp,
  subject: string,
  text: string,
  date = new Date(),
): Promise<void> {
  const scheme = smtp.port === '465' || smtp.port === '2465' ? 'smtps' : 'smtp';
  const file = join(tmpdir(), `plx-ci-mail-${process.pid}.eml`);
  const config = [
    `url = "${scheme}://${smtp.host}:${smtp.port}"`,
    'ssl-reqd',
    'silent',
    'show-error',
    `mail-from = "${smtp.from}"`,
    `mail-rcpt = "${smtp.to}"`,
    `user = ${JSON.stringify(`${smtp.user}:${smtp.password}`)}`,
    `upload-file = ${JSON.stringify(file)}`,
  ].join('\n');
  await ctx.apply([write(file, message(smtp, subject, text, date)), run('curl', ['-K', '-'], { input: config })]);
}
